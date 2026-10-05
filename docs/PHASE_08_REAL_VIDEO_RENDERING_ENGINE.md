# PHASE 08 — REAL VIDEO RENDERING ENGINE (FFMPEG WORKER)
> **Estado:** COMPLETADA ✅  
> **Fecha:** 4 de Octubre de 2026  
> **Perfil Operativo:** Principal Research Software Engineer & AI Systems Architect  
> **Test Suite:** 170 tests globales pasando al 100% (16 tests específicos de Phase 08)

---

## 1. Resumen Ejecutivo de la Fase

La **Phase 08** extirpa de raíz la simulación de renderizado por temporizadores (`setTimeout`) que residía en el cliente Angular, dotando a **Cartoon Studio** de un motor real, desacoplado y server-first de composición y codificación de vídeo digital impulsado por **FFmpeg nativo**.

El subsistema resultante implementa:
1. **Envoltorio Mecánico de FFmpeg (`ffmpeg.wrapper.ts`):** Invocación transparente y libre de librerías pesadas (*zero-bloatware*) mediante `node:child_process.spawn`. Control de procesos hijos, captura de telemetría de progreso temporal (`time=HH:MM:SS.xx`), soporte para efectos de cámara y paneo Ken Burns, y demuxer de concatenación sin re-codificación (`-f concat -c copy`).
2. **Sintetizador Mecánico de Banda Sonora Infantil (`music.synthesizer.ts`):** Generador determinista de pistas instrumentales en formato WAV 44.1kHz 16-bit PCM estéreo (xilófono, marimba y acordes pizzicato en escala de Do Mayor a 110 BPM) calibrado a la duración exacta del episodio para entornos de desarrollo y pruebas offline.
3. **Orquestador Asíncrono de Renderizado (`render.service.ts`):** Pipeline no bloqueante estructurado en 7 etapas atómicas (`PREPARE_MEDIA`, `GENERATE_SUBTITLES`, `SYNTHESIZE_MUSIC`, `RENDER_SCENES`, `CONCAT_TIMELINE`, `MIX_AUDIO`, `FINALIZE_STORAGE`), subida física a `StorageProvider` (MP4 H.264/AAC, WebVTT y SRT) y registro en PostgreSQL de activos `Asset` (`VIDEO_RENDER`) y versiones inmutables con suma criptográfica SHA-256.
4. **API REST Canónica Asíncrona (`render.router.ts`):** Endpoint de inicio de trabajo `POST /api/render/start` con semántica estándar **HTTP 202 Accepted**, endpoint de sondeo `GET /api/render/jobs/:jobId`, canal Server-Sent Events (SSE) `GET /api/render/jobs/:jobId/events` para progreso en streaming y cancelación reactiva `POST /api/render/jobs/:jobId/cancel`.
5. **Reproductor Cinema MP4 en Angular (`AnimationEditorView` & `Studio`):** Integración reactiva en la SPA con reproductor nativo HTML5 `<video controls>` con soporte de pista de subtítulos `<track kind="subtitles">`, descarga directa y barra de estado animada en tiempo real.

---

## 2. Topología de Componentes & Flujo Asíncrono

```
                              [FRONTEND (Angular 21 SPA)]
                              ├── Studio.renderVideo()
                              └── AnimationEditorView
                                       │
                      1. POST /api/render/start (JWT Auth)
                                       ▼
                        [EXPRESS API (src/server.ts)]
                                       │
                                       ├─────────────────────────────┐
                          2. 202 Accepted { jobId, pollUrl }         │ 3. Despacho en background
                                       ▼                             ▼
                            [Cliente Angular Polling]     [RenderService (Worker Core)]
                            ├── GET /api/render/jobs/:id             │
                            └── GET /.../jobs/:id/events (SSE)       ├── Step 1: Descarga/Generación de imágenes y audios
                                                                     ├── Step 2: Compilación de subtítulos WebVTT y SRT
                                                                     ├── Step 3: Síntesis de música infantil (WAV 44.1kHz)
                                                                     ├── Step 4: Renderizado de clips de escena (FFmpeg)
                                                                     ├── Step 5: Concatenación sin pérdida (-c copy)
                                                                     ├── Step 6: Multiplexado y mezcla de audio (amix)
                                                                     └── Step 7: Subida a Storage y persistencia en DB
                                                                             │
                                       ┌─────────────────────────────────────┴─────────────────────────────────────┐
                                       ▼                                                                           ▼
                          [StorageProvider (Local/S3)]                                                [PostgreSQL 16 / Prisma]
                          - episodes/{id}/render/video_{jobId}.mp4                                    - production_jobs (COMPLETED)
                          - episodes/{id}/render/subtitles_{jobId}.vtt                                - assets (type: VIDEO_RENDER)
                          - episodes/{id}/render/subtitles_{jobId}.srt                                - asset_versions (SHA-256)
```

---

## 3. Especificación Técnica de los Módulos Implementados

### 3.1. Envoltorio de FFmpeg (`src/server/render/ffmpeg.wrapper.ts`)
* **Detección y Sonda:** Función `checkFfmpegAvailability()` que valida la presencia del binario y extrae la versión del motor mediante `ffmpeg -version`.
* **Procesamiento de Fotogramas y Cámara:** Función `renderSceneClip()` que compone fotogramas PNG y locuciones WAV en clips independientes MP4 aplicando escalado con relación de aspecto preservada (`scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080`) o filtros dinámicos Ken Burns (`zoompan`).
* **Demuxing de Concatenación Instantáneo:** Función `concatSceneClips()` que construye un manifiesto `concat_manifest.txt` con rutas normalizadas y une los fragmentos mediante `-f concat -safe 0 -c copy` en menos de 700 ms sin pérdida generacional de compresión.
* **Mezcla Multi-Pista:** Función `mixAudioTracks()` que aplica un grafo de filtros `[0:a]volume=1.0[v];[1:a]volume=0.15[m];[v][m]amix=inputs=2:duration=first` para equilibrar el volumen de voces con la banda sonora ambiental.

### 3.2. Síntesis de Música de Fondo (`src/server/render/music.synthesizer.ts`)
* **Fundamentos Mecánicos:** Sintetizador auditivo directo que genera un flujo PCM lineal de 16 bits sin dependencias externas.
* **Progresión Armónica Infantil:** Bucle de 4 compases en tonalidad de Do Mayor ($C \rightarrow G \rightarrow Am \rightarrow F$) a 110 BPM.
* **Composición Tímbrica:** Combina bajo en tono fundamental con decaimiento de cuerda pulsada, acordes en xilófono en los tiempos 2 y 4, y arpegios agudos de marimba en corcheas con armónicos impares amortiguados.

### 3.3. Servicio Orquestador (`src/server/render/render.service.ts`)
* **Aislamiento en Espacio Temporal:** Cada trabajo crea un directorio aislado `tmp/cartoon_render_{jobId}` garantizando limpieza absoluta mediante bloque `try ... finally` sin dejar archivos huérfanos en disco.
* **Resiliencia de Recursos:** Si alguna escena carece de imagen o locución preexistente, el orquestador activa de forma transparente los proveedores deterministas (`SyntheticImageProvider` y `generateSyntheticVoiceWave`) para completar el renderizado sin abortar.
* **Transacciones e Inmutabilidad:** Al culminar la codificación, calcula el checksum SHA-256 del archivo de vídeo, lo sube al `StorageProvider`, registra el `Asset` y su `AssetVersion` inmutable, y actualiza el `ProductionJob` a estado `COMPLETED` con progreso al 100%.

---

## 4. Matriz de Endpoints REST Creados

| Método | Endpoint | Autenticación | Payload / Parámetros | Código HTTP | Respuesta Principal |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/render/capabilities` | Pública | Ninguno | 200 OK | `{ success: true, capabilities: { available: true, version: "8.0.1", ... } }` |
| `POST` | `/api/render/start` | `requireAuth` (JWT) | `StartRenderRequestSchema` (JSON) | **202 Accepted** | `{ success: true, jobId: "job_render_...", status: "QUEUED", pollUrl, streamUrl }` |
| `GET` | `/api/render/jobs/:jobId` | `requireAuth` (JWT) | `:jobId` en URL | 200 OK | `{ success: true, job: { progress: 100, status: "COMPLETED", result: { ... } } }` |
| `GET` | `/api/render/jobs/:jobId/events` | `requireAuth` (JWT) | `:jobId` en URL | 200 SSE | Flujo continuo Server-Sent Events (`data: { progress, stepDescription, ... }\n\n`) |
| `POST` | `/api/render/jobs/:jobId/cancel` | `requireAuth` (JWT) | `:jobId` en URL | 200 OK | `{ success: true, message: "Trabajo cancelado con éxito." }` |

---

## 5. Verificación Empírica y Suite de Pruebas

Se ejecutó la suite de pruebas completa del proyecto con **Vitest**:

```
 Test Files  6 passed (6)
      Tests  170 passed (170)
   Duration  11.67s
```

### Cobertura de Phase 08 (`src/server/render/render.spec.ts` — 16/16 tests pasando):
1. **Detección de Binario FFmpeg:** Verificación de versión y parsing de códigos de tiempo (HH:MM:SS.xx a segundos flotantes).
2. **Generación de Filtros de Movimiento:** Validación sintáctica de expresiones de filtro para `static`, `zoom-in` y `ken-burns`.
3. **Síntesis Musical en WAV:** Comprobación de cabecera RIFF de 44 bytes, tamaño exacto según duración ($44 + \text{duración} \times 44100 \times 4$ bytes) y ausencia de muestras indefinidas o recortadas.
4. **Codificación Real con FFmpeg:** Renderizado físico de clip de vídeo MP4 válido (comprobación de caja `ftyp` en cabecera de archivo y tamaño > 1 KB).
5. **Concatenación de Escenas:** Unión de múltiples clips MP4 mediante demuxer de concatenación sin re-codificación en < 700 ms.
6. **Orquestación End-to-End:** Ciclo de vida completo del job: `QUEUED` $\rightarrow$ `PROCESSING` $\rightarrow$ `COMPLETED` con emisión de eventos, subida a `StorageProvider`, cálculo de checksum SHA-256 y metadatos de resolución.
7. **Control y Cancelación:** Comprobación de aborto inmediato mediante `cancelJob()` y actualización de estado a `CANCELLED`.
8. **Seguridad y Rutas REST:** Rechazo 401 en accesos no autenticados, validación Zod 400 en cargas incompletas, y respuestas 202 Accepted en despachos válidos.
