# PHASE 06 — Real Voice & Audio Pipeline (Technical Architecture & Engineering Report)

> **Perfil Operativo:** Principal Research Software Engineer & AI Systems Architect  
> **Fecha:** 4 de Octubre de 2026  
> **Estado:** 🟢 COMPLETADA & VALIDADA (133/133 Tests pasando en Vitest + Build Angular/SSR limpio)  
> **Directiva:** Server-First Architecture, Zero Bloat, Zero Rutas Windows, Paridad Local/Producción  

---

## 1. Resumen Ejecutivo & Objetivos Alcanzados

La **Phase 06** elimina por completo la simulación volátil de voz (`window.speechSynthesis` del navegador) e instaura un motor completo de síntesis vocal física y alineación temporal en el backend:

1. **Motor Mecánico WAV RIFF/PCM (Zero-Dependency):**
   - Generación binaria y decodificación de cabeceras canónicas RIFF/WAVE de 44 bytes para audio lineal PCM de 16 bits sin compresión.
   - Analizador binario estricto (`parseWavInfo`) que calcula la duración exacta del archivo con resolución de microsegundos a partir de los bytes de muestra y el `byteRate`.
   - Síntesis de ondas de voz sintética multifórmica determinista (`generateSyntheticVoiceWave`) para desarrollo offline, pruebas unitarias y entornos sin credenciales externas, garantizando que el sistema siempre genere archivos `.wav` 100% reproducibles sin dependencias pesadas.

2. **Conector Google Cloud Text-to-Speech (Neural2 & Journey):**
   - Integración nativa con la API REST `https://texttospeech.googleapis.com/v1/text:synthesize` usando `fetch` estándar y codificación `LINEAR16`.
   - Modulación de tono (*pitch*) convertida logarítmicamente a semitonos ($[-10.0, +10.0]$ st) y velocidad de habla (*speakingRate*) acotada.
   - Catálogo de voces preescolares infantiles (`es-ES-Neural2-A`, `es-ES-Neural2-C`, `es-ES-Neural2-B`, `es-US`, `en-US`).
   - Mecanismo de degradación elegante (*graceful fallback*) ante falta de API key o denegación de cuota hacia el motor de ondas sintéticas.

3. **Motor de Alineación Temporal & Subtítulos (SRT & WebVTT):**
   - Algoritmo de temporización milimétrica con aritmética entera libre de errores de redondeo IEEE 754.
   - Generación de pistas SubRip (`.srt`) con separador de coma (`00:00:00,000`) y WebVTT (`.vtt`) con separador de punto (`00:00:00.000`) y etiquetas de locutor (`<v Milo>`).
   - Cálculo de desfase temporal (*audio drift*) escena por escena contra la duración nominal prevista, alimentando los umbrales deterministas de control de calidad (Phase 09).

4. **Integración con StorageProvider y Telemetría Transaccional:**
   - Almacenamiento desacoplado de archivos `.wav`, `.vtt` y `.srt` bajo claves normalizadas POSIX (`episodes/:episodeId/scenes/:sceneCode/voice.wav`).
   - Telemetría persistida en `provider_executions` (PostgreSQL) con hash SHA-256 de solicitud, caracteres procesados, coste contable en Euros (€0.015 / 1,000 caracteres) y latencia.

5. **Exposición REST & Experiencia de Usuario en Angular:**
   - Enrutador Express `voiceRouter` montado en `/api/voice` con endpoints protegidos por JWT (`/scene`, `/batch`) y endpoints públicos para audición en tiempo real (`/catalog`, `/test`).
   - Vistas de Angular actualizadas con reproductor nativo de audio HTML5, indicadores de estado de síntesis y disparador de lote completo.

---

## 2. Mapa de Componentes y Topología

```
[Cliente Angular / Studio Service]
        │
        ├──► POST /api/voice/test (Audición inmediata de voz en base64)
        ├──► POST /api/voice/scene (Síntesis atómica por escena con JWT)
        └──► POST /api/voice/batch (Síntesis masiva del episodio con JWT)
                    │
                    ▼
          ┌────────────────────────────────────────────────────────┐
          │             API ROUTER (/api/voice)                    │
          │   - Validación de esquemas Zod                         │
          │   - Control de acceso requireAuth                      │
          └─────────────────────────┬──────────────────────────────┘
                                    │
                                    ▼
          ┌────────────────────────────────────────────────────────┐
          │               VOICE PIPELINE SERVICE                   │
          │   - Invocación de GoogleCloudTTSProvider               │
          │   - Fallback automático a generateSyntheticVoiceWave   │
          │   - Cálculo de duración exacta y drift                 │
          │   - Construcción de pistas WebVTT y SRT                │
          └───────┬───────────────────────────────┬────────────────┘
                  │                               │
                  ▼                               ▼
      ┌────────────────────────┐      ┌─────────────────────────────┐
      │    STORAGE PROVIDER    │      │     TELEMETRY SERVICE       │
      │  - episodes/.../voice  │      │  - provider_executions      │
      │  - subtitles/dialogue  │      │  - Request Hash SHA-256     │
      │  - Streaming HTTP 206  │      │  - Coste exacto en EUR (€)  │
      └────────────────────────┘      └─────────────────────────────┘
```

---

## 3. Especificaciones Técnicas Detalladas

### 3.1. Estructura Binaria de la Cabecera RIFF/WAVE (44 Bytes)
| Offset | Campo | Tipo | Valor Canónico | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `0..3` | `ChunkID` | ASCII | `RIFF` | Identificador de contenedor multimedia RIFF |
| `4..7` | `ChunkSize` | uint32 LE | `36 + dataSize` | Tamaño total del archivo menos 8 bytes |
| `8..11` | `Format` | ASCII | `WAVE` | Formato de forma de onda |
| `12..15`| `Subchunk1ID` | ASCII | `fmt ` | Identificador de bloque de formato |
| `16..19`| `Subchunk1Size` | uint32 LE | `16` | Tamaño del subchunk fmt (16 para PCM) |
| `20..21`| `AudioFormat` | uint16 LE | `1` | Formato de compresión (1 = PCM lineal) |
| `22..23`| `NumChannels` | uint16 LE | `1` | Canales (1 = Mono, 2 = Stereo) |
| `24..27`| `SampleRate` | uint32 LE | `24000` | Frecuencia de muestreo en Hz |
| `28..31`| `ByteRate` | uint32 LE | `48000` | `SampleRate * NumChannels * (BitsPerSample / 8)` |
| `32..33`| `BlockAlign` | uint16 LE | `2` | `NumChannels * (BitsPerSample / 8)` |
| `34..35`| `BitsPerSample` | uint16 LE | `16` | Profundidad de cuantización de 16 bits |
| `36..39`| `Subchunk2ID` | ASCII | `data` | Identificador del bloque de muestras PCM |
| `40..43`| `Subchunk2Size` | uint32 LE | `dataSize` | Longitud en bytes de las muestras de audio |

### 3.2. Catálogo de Presets Vocales Infantiles
| Preset ID | Nombre | Voz GCP | Idioma | Género | Tono Rec. | Velocidad | Timbre |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `milo-preschool` | Milo | `es-ES-Neural2-A` | `es-ES` | Femenino | 1.15 | 0.95 | Infantil activo y curioso |
| `tula-hare` | Tula | `es-ES-Neural2-C` | `es-ES` | Femenino | 1.25 | 1.05 | Vivaz, perspicaz y tierna |
| `narrator-storybook` | Narrador | `es-ES-Neural2-B` | `es-ES` | Masculino | 0.92 | 0.92 | Cálido, paternal de cuento |
| `bubu-bear` | Bubu Oso | `es-ES-Neural2-F` | `es-ES` | Masculino | 0.78 | 0.88 | Grave, tranquilo y protector |
| `chico-latam` | Mateo | `es-US-Neural2-B` | `es-US` | Masculino | 1.10 | 0.98 | Neutro hispanoamericano |
| `piper-english` | Oliver | `en-US-Neural2-A` | `en-US` | Masculino | 1.12 | 0.96 | Infantil inglés internacional |

---

## 4. Matriz de Cobertura de Pruebas Unitarias e Integración

| Bloque de Pruebas | Casos Ejecutados | Estado |
| :--- | :---: | :---: |
| **1. Codificación Binaria WAV** | Generación de cabecera de 44 bytes, validación de offsets, detección mágica `RIFF/WAVE`, captura de errores `WavFormatError`. | 🟢 PASS |
| **2. Duraciones & Parsing** | Verificación de cálculo microsegundo, preservación de cabecera existente, empaquetado de PCM crudo. | 🟢 PASS |
| **3. Síntesis Sintética Determinista** | Generación de onda de 16 bits PCM, escala de duración con velocidad, limitación fisiológica de modulación. | 🟢 PASS |
| **4. Catálogo de Voces** | Presets infantiles preescolares, filtrado por prefijos de idioma. | 🟢 PASS |
| **5. Google Cloud TTS & Fallbacks** | Fallback sin API key, validación de texto no vacío, resistencia ante fallos de red remota. | 🟢 PASS |
| **6. Alineación & Subtítulos** | Formateo milimétrico SRT (coma) y VTT (punto), bloques con locutor, cálculo de timeline acumulada y drift. | 🟢 PASS |
| **7. Voice Pipeline & Storage** | Carga de archivos `.wav` a `StorageProvider`, generación y persistencia de subtítulos WebVTT/SRT, audición de personaje. | 🟢 PASS |
| **8. Rutas REST & Seguridad JWT** | Acceso público a `/catalog` y `/test`, rechazo 401 en `/scene` y `/batch` sin token, síntesis exitosa 201 con JWT. | 🟢 PASS |
| **Total Suite Phase 06** | **28 pruebas** | **100% PASS** |
| **Total Suite Global Proyecto** | **133 pruebas** | **100% PASS** |
