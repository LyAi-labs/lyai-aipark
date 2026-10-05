# PHASE 07 — VISUAL GENERATION & STORYBOARD PIPELINE
> **Estado:** COMPLETADA ✅  
> **Fecha:** 4 de Octubre de 2026  
> **Perfil Operativo:** Principal Research Software Engineer & AI Systems Architect  
> **Test Suite:** 154 tests globales pasando al 100% (21 tests específicos de Phase 07)

---

## 1. Resumen Ejecutivo de la Fase

La **Phase 07** erradica la dependencia de representaciones sintéticas basadas exclusivamente en vectores SVG en memoria, dotando a **Cartoon Studio** de un motor completo de generación visual ráster en alta resolución (16:9 y miniaturas 1280x720) persistido físicamente a través de la abstracción `StorageProvider`.

El sistema incorpora:
1. **Codificador Binario PNG Nativo (`png.encoder.ts`):** Motor de compresión y rasterizado determinista sin dependencias externas (*zero-bloatware*), implementando RFC 2083 / ISO/IEC 15948 con memoria contigua de escaneo RGBA y `zlib.deflateSync`.
2. **Motor de Consistencia Visual (`consistency.engine.ts`):** Compilador de prompts maestros de personajes, reglas de estilo de franquicia, semillas pseudo-aleatorias reproducibles de 32 bits (`deriveDeterministicSeed`) y guardarraíles negativos infantiles estrictos.
3. **Proveedores Desacoplados (`ImagenProvider` & `SyntheticImageProvider`):** Conexión con `@google/genai` (Google Imagen 3) con conmutación por fallo automática (*fail-safe fallback*) al generador de ráster determinista en caso de cuota agotada, ausencia de credenciales o tests offline.
4. **Orquestador de Dominio (`VisualService`):** Integración con `StorageProvider` (rutas POSIX normalizadas, cero `C:\Users...`), persistencia en PostgreSQL (`assets` e inmutables `asset_versions` con checksum SHA-256) y telemetría de costes en `provider_executions`.
5. **API REST Canónica (`visual.router.ts`):** Endpoints `/api/visuals/scene`, `/api/visuals/batch`, `/api/visuals/character` y `/api/visuals/thumbnail` protegidos mediante JWT y validados al 100% con Zod.
6. **Experiencia Frontend Reactiva (`StoryboardView` & `Studio`):** Integración de previsualización dual (Ráster PNG real con badges de estado vs SVG previo), regeneración atómica por escena y despacho por lotes.

---

## 2. Topología de Componentes e Invariantes

```
                           [FRONTEND (Angular 21 SPA)]
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
        [StoryboardView Component]                [Studio Service]
        - Dual render: PNG real vs SVG            - generateSceneRasterVisual()
        - Badges: 16:9 PNG RÁSTER / SVG           - generateAllEpisodeVisuals()
        - Batch Generation Button                 - isGeneratingVisuals signal
                    │                                     │
                    └──────────────────┬──────────────────┘
                                       │ POST /api/visuals/scene | batch
                                       ▼ (JWT Bearer / Cookie)
                        [EXPRESS SERVER (src/server.ts)]
                                       │
                                       ▼
                       [visualRouter (/api/visuals)]
                                       │
                                       ▼
                     ┌──────────────────────────────────┐
                     │          VisualService           │
                     └─────────────────┬────────────────┘
                                       │
               ┌───────────────────────┼───────────────────────┐
               ▼                       ▼                       ▼
      [ConsistencyEngine]      [ImageProvider]        [StorageProvider]
      - Master Prompts        ├── ImagenProvider      - Rutas POSIX
      - Style Invariants      └── SyntheticProvider   - SHA-256 Checksum
      - Seeds deterministas    - PNG Encoder nativo   - Public Streaming
               │                       │                       │
               └───────────────────────┼───────────────────────┘
                                       │
                                       ▼
                       [PostgreSQL 16 (Prisma ORM)]
                       - assets (IMAGE_SCENE, THUMBNAIL)
                       - asset_versions (sizeBytes, SHA-256)
                       - provider_executions (telemetría & coste EUR)
```

---

## 3. Especificación Técnica de Componentes

### 3.1. Codificador Binario PNG Puro (`src/server/visuals/png.encoder.ts`)
* **Memoria y Localidad:** Almacenamiento contiguo en un `Uint8Array` plano de tamaño $\mathcal{O}(W \times H \times 4)$ bytes.
* **Manejo de Scanlines:** Genera buffers scanline de tipo de filtro 0 (None) comprimidos mediante el algoritmo DEFLATE estándar (`node:zlib.deflateSync`).
* **Integridad de Chunks:** Ensambla cabecera canónica de 8 bytes `89 50 4E 47 0D 0A 1A 0A` y chunks `IHDR`, `IDAT` e `IEND` calculando el CRC-32 con tabla precalculada de polinomio IEEE 802.3 `0xEDB88320`.
* **Primitivas Gráficas Rápidas:** Gradientes verticales lineales con interpolación de color, elipses, discos con resplandor radial suave (`drawSun`), siluetas vectoriales rasterizadas y blending alfa real.

### 3.2. Motor de Consistencia de Personajes (`src/server/visuals/consistency.engine.ts`)
* **Determinismo de Seeds:** Función `deriveDeterministicSeed(...tokens)` que proyecta cadenas de caracteres a un entero sin signo de 32 bits mediante SHA-256. Garantiza que escenas con los mismos personajes e iluminación mantengan una semilla estricta.
* **Compilación de Prompts:** Fusiona la paleta de colores (`colorPalette`), ropa (`clothing`), rasgos visuales (`visualFeatures`) y prompt maestro del personaje con la atmósfera lumínica de la escena (Golden Hour, Midday, Peaceful Night, Morning Sunbeams).
* **Filtro Negativo Estricto:** Inyección forzada de directivas infantiles y técnicas (`photorealistic, realistic human skin, terrifying, dark, sinister, blood, horror, deformed, distorted limbs, bad anatomy, blurry`).

### 3.3. Proveedores de Imagen (`src/server/visuals/`)
* **`ImagenProvider`:** Conecta con `@google/genai` invocando `ai.models.generateImages` con `aspectRatio: '16:9'` o `'1:1'`. En caso de cualquier error (401, 403, 429, o soporte de plataforma), activa silenciosamente el fallback hacia `SyntheticImageProvider`.
* **`SyntheticImageProvider`:** Implementación nativa que genera imágenes ráster PNG completas en 16:9 para escenas, 1:1 para model sheets y 1280x720 para miniaturas de YouTube sin requerir red ni GPU.

### 3.4. Servicio Orquestador (`src/server/visuals/visual.service.ts`)
* Almacena activos en rutas POSIX normalizadas: `episodes/${episodeId}/visuals/scene_${sceneCode}_${hash}.png`.
* Registra o actualiza el agregador de base de datos `Asset` y crea un `AssetVersion` inmutable con su checksum SHA-256 y tamaño exacto.
* Telemetría registrada en `provider_executions` con coste en euros exacto (`calculateImageCostEur`, 0.025 € en producción o 0.00 € en sintético).

---

## 4. Matriz de Endpoints REST Creados

| Método | Endpoint | Autenticación | Payload | Respuesta |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/visuals/scene` | `requireAuth` (JWT) | `SceneVisualSchema` (JSON) | 200 OK `{ success: true, visual: { publicUrl, storageKey, checksumSha256 } }` |
| `POST` | `/api/visuals/batch` | `requireAuth` (JWT) | `BatchVisualSchema` (JSON) | 200 OK `{ success: true, batch: { totalImagesGenerated, scenes: [...] } }` |
| `POST` | `/api/visuals/character` | `requireAuth` (JWT) | `CharacterVisualSchema` (JSON) | 200 OK `{ success: true, character: { publicUrl, storageKey } }` |
| `POST` | `/api/visuals/thumbnail` | `requireAuth` (JWT) | `ThumbnailVisualSchema` (JSON) | 200 OK `{ success: true, thumbnail: { publicUrl, storageKey } }` |

---

## 5. Resultados de Validación y Verificación Empírica

1. **Pruebas Automatizadas Unitarias & de Integración:**
   ```bash
   npx vitest run
   ```
   * **Test Files:** 5 passed (5)
   * **Tests:** 154 passed (154)
   * **Duración:** ~12.1 segundos
   * Desglose:
     * `src/server/visuals/visual.spec.ts`: 21 tests (100% pass)
     * `src/server/storage/storage.spec.ts`: 40 tests (100% pass)
     * `src/server/auth/auth.security.spec.ts`: 34 tests (100% pass)
     * `src/server/ai/ai.security.spec.ts`: 31 tests (100% pass)
     * `src/server/audio/audio.spec.ts`: 28 tests (100% pass)

2. **Compilación de Producción (Angular 21 + Node SSR):**
   ```bash
   npm run build
   ```
   * Generación limpia de bundles cliente (`main-*.js`, `styles-*.css`) y bundles de servidor SSR (`server.mjs`, `main.server.mjs`). Cero errores de TypeScript.
