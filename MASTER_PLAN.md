# MASTER_PLAN.md — Cartoon Studio Architecture & Production Blueprint

> **Estado del Documento:** Versión 1.1 — Directiva Arquitectónica Server-First & Plan Director  
> **Rama de Trabajo:** `Try1` (Baseline: Google AI Studio `main` @ `1eae2f8`)  
> **Perfil Operativo:** Principal Research Software Engineer & AI Systems Architect  
> **Fecha:** 3 de Octubre de 2026  

---

## 0. DIRECTIVA MAESTRA DE DESPLIEGUE: SERVER-FIRST ARCHITECTURE (DEPLOYMENT TARGET)

### 0.1. Principio Rector: Local Development → Remote Production
El destino final de **Cartoon Studio** es un servidor remoto de producción (Linux / Cloud). El entorno local se utilizará exclusivamente para:
* Desarrollo activo
* Pruebas y test suites automatizados
* Debugging e inspección de estados
* Generación puntual y profiling durante desarrollo

> [!IMPORTANT]
> **REGLA DE ORO DE DISEÑO:** La arquitectura **NO** se diseñará como una aplicación Windows local que posteriormente sea migrada a servidor. Se diseña **desde el primer commit** como una aplicación distribuida orientada a servidor (*server-first*), garantizando estricta paridad de desarrollo/producción (*dev/prod parity*).

### 0.2. Producción Objetivo (Topología Docker Compose)
La arquitectura modular inicial contempla la segregación de responsabilidades en contenedores independientes orquestados conceptualmente mediante Docker Compose:

```
Docker Compose Topología
├── reverse-proxy    (Nginx / Traefik: SSL termination, compresión, routing)
├── cartoon-web      (Angular 21 SPA compilada / SSR en contenedor optimizado)
├── cartoon-api      (Node.js Express / Fastify: REST API, Auth, Zod, Orchestration)
├── cartoon-worker   (Node.js / Python Worker: FFmpeg, TTS, AI pipelines, Long-Running Jobs)
├── postgres         (PostgreSQL 16: Persistencia relacional, transacciones, colas)
└── storage          (MinIO en dev / S3-Compatible Storage en prod)
```

**Escalabilidad Futura:** Esta separación garantiza que cuando la carga de renderizado o generación aumente, `cartoon-worker`, `cartoon-api` y `postgres` puedan desplegarse en instancias o máquinas dedicadas sin modificar la lógica de negocio.

### 0.3. Base de Datos: PostgreSQL desde el Principio
* **PostgreSQL** es el motor principal desde la Fase 02.
* **Prohibido SQLite** como arquitectura principal o atajo de diseño.
* Se empleará **Prisma ORM** sobre PostgreSQL para modelado declarativo, migraciones automáticas (`prisma migrate`) y tipado end-to-end.

### 0.4. Almacenamiento: Abstracción `StorageProvider` (Zero Path Hardcoding)
* **Prohibición Absoluta:** Queda terminantemente prohibido utilizar rutas absolutas de Windows o acoplar la lógica a rutas tipo `C:\Users\...`.
* **Contrato de Abstracción:**
  ```typescript
  interface StorageProvider {
    upload(key: string, data: Buffer | Readable, mimeType: string): Promise<string>;
    download(key: string): Promise<Buffer>;
    getPublicUrl(key: string): string;
    delete(key: string): Promise<void>;
  }
  ```
* **Drivers Intercambiables:**
  * `LocalStorageProvider`: Para desarrollo local, almacena bajo rutas relativas al workspace (`./storage/assets/...`) normalizadas con separadores POSIX.
  * `S3CompatibleStorageProvider`: Para entorno servidor remoto (AWS S3, Cloudflare R2, MinIO o Google Cloud Storage).
* La transición entre ambos se gestiona únicamente mediante la variable de entorno `STORAGE_DRIVER=local|s3`.

### 0.5. Renderizado de Vídeo & Aislamiento del Worker
* **FFmpeg se ejecuta exclusivamente dentro de `cartoon-worker`**.
* La API **nunca** se bloquea esperando un renderizado ni mantiene conexiones HTTP abiertas durante procesos pesados.
* **Flujo Transaccional Asíncrono:**
  ```
  API (POST /projects/:id/render)
    │
    ▼
  Crea Job en PostgreSQL (status='queued')
    │
    ▼ Retorna 202 Accepted { jobId } de inmediato
  Worker detecta / consume Job
    │
    ▼
  Ejecuta pipeline FFmpeg (ensamblado de vídeo, audio, subtítulos)
    │
    ▼
  Sube resultado a StorageProvider (MP4 final)
    │
    ▼
  Actualiza Job en PostgreSQL (status='completed', videoUrl='...')
  ```

### 0.6. Gestión de Trabajos de Larga Duración (Long-Running Jobs)
Las siguientes operaciones son intrínsecamente asíncronas y se procesan exclusivamente como **Jobs en cola en segundo plano**:
1. Generación de historias completas (Gemini 3.8 Flash)
2. Síntesis de voz escena por escena (TTS)
3. Generación de imágenes / miniaturas ráster
4. Renderizado y codificación de vídeo (FFmpeg)
5. Control de Calidad automatizado (QC)
6. Subida masiva de vídeo y miniaturas a YouTube (YouTube Data API v3)

### 0.7. Configuración & Portabilidad Total (12-Factor App)
* Toda configuración dependiente del entorno reside exclusivamente en variables de entorno.
* **Cero Secretos Hardcodeados:** Prohibido escribir passwords, API keys, secrets de OAuth, credenciales de DB, tokens de YouTube o rutas en el código fuente.
* El paso de Local a Remoto **no requiere alterar una sola línea de código**; únicamente la inyección de variables de entorno y recursos de infraestructura.

---

## 1. ESTADO ACTUAL (Auditoría Técnica en Profundidad)

### 1.1. Inventario Clasificado del Sistema

| Componente / Subsistema | Clasificación | Evidencia en Código |
| :--- | :--- | :--- |
| **Generación de Historias (AI)** | **IMPLEMENTADO PARCIALMENTE** | `POST /api/generate-story` en [src/server.ts](file:///c:/Users/Glado/CartoonFactory/src/server.ts#L31). Llama a Gemini 3.8 Flash si `GEMINI_API_KEY` existe; fallback template estático si no. Inyección de prompt no tipada. |
| **Generación de Personajes (AI)** | **IMPLEMENTADO PARCIALMENTE** | `POST /api/generate-character` en [src/server.ts](file:///c:/Users/Glado/CartoonFactory/src/server.ts#L231). Genera JSON de biblia de personajes; visuales son SVGs fijos. |
| **Control de Calidad (QC)** | **IMPLEMENTADO PARCIALMENTE** | `POST /api/quality-control` en [src/server.ts](file:///c:/Users/Glado/CartoonFactory/src/server.ts#L304). Evaluación heurística vía prompt LLM; no analiza video ni audio real. |
| **Metadatos YouTube (SEO/COPPA)** | **IMPLEMENTADO PARCIALMENTE** | `POST /api/generate-metadata` en [src/server.ts](file:///c:/Users/Glado/CartoonFactory/src/server.ts#L374). Genera títulos, descripciones y tags orientados a niños. |
| **Renderizado de Vídeo** | **MOCK / SIMULACIÓN TOTAL** | [src/app/services/studio.ts](file:///c:/Users/Glado/CartoonFactory/src/app/services/studio.ts#L926-L940): 3 `setTimeout` encadenados simulando avance de progreso (15% → 45% → 80% → 100%). Cero codificación de frames o audio MP4. |
| **Síntesis de Voz (Voice/TTS)** | **MOCK / SIMULACIÓN CLIENTE** | [src/app/components/voice-view.ts](file:///c:/Users/Glado/CartoonFactory/src/app/components/voice-view.ts#L180): `window.speechSynthesis.speak()` del navegador. No genera ni guarda ficheros de audio en disco o backend. |
| **Generación de Visuales / Arte** | **MOCK / PLANTILLAS SVG** | [src/app/services/visual-generator.ts](file:///c:/Users/Glado/CartoonFactory/src/app/services/visual-generator.ts#L11): Código SVG hardcodeado con siluetas de zorro Milo y liebre Tula. Cero llamadas a Imagen 3 o generadores visuales. |
| **YouTube OAuth 2.0** | **AUSENTE / UI MOCK** | Indicador en UI *"CONECTADO OAUTH 2.0"*, pero el canal es un objeto hardcodeado (`mockConnectedChannel` en [src/server.ts](file:///c:/Users/Glado/CartoonFactory/src/server.ts#L445)). No existen client ID, secret, callback ni tokens. |
| **Publicación en YouTube** | **MOCK / SIMULACIÓN TOTAL** | `POST /api/youtube/publish` en [src/server.ts](file:///c:/Users/Glado/CartoonFactory/src/server.ts#L465): Retorna strings aleatorios `pub_...` y `https://youtube.com/watch?v=mock_...`. Cero interacción con YouTube Data API. |
| **Persistencia / Base de Datos** | **AUSENTE** | No existe base de datos ni `localStorage`. Todo el estado reside en memoria volátil de Angular Signals (`signal<Project[]>`). Un refresco F5 reinicia el estudio a los datos semilla. |
| **Planificador / Scheduler** | **MOCK VISUAL** | [src/app/components/calendar-view.ts](file:///c:/Users/Glado/CartoonFactory/src/app/components/calendar-view.ts): Cuadrícula estática de días de octubre de 2026. No hay demonios, colas de trabajo ni cron jobs. |
| **Métricas / Analytics** | **MOCK VISUAL** | [src/app/components/analytics-view.ts](file:///c:/Users/Glado/CartoonFactory/src/app/components/analytics-view.ts): Cifras preestablecidas (18.4M views, 412.8K h) hardcodeadas en la plantilla. |
| **Autenticación y Usuarios** | **AUSENTE** | No existe noción de sesión, usuario, JWT, cookies de sesión ni control de acceso multi-inquilino. |
| **Enrutamiento Web** | **DEUDA TÉCNICA SEVERA** | [src/app/app.routes.ts](file:///c:/Users/Glado/CartoonFactory/src/app/app.routes.ts) está vacío (`routes = []`). La navegación se realiza por `@switch (studio.activeSection())` en un único componente. Cero URLs navegables. |
| **Arquitectura de API Client** | **DEUDA TÉCNICA** | Componentes individuales invocan `fetch()` directamente en lugar de usar servicios Angular centralizados con `HttpClient`. |

---

### 1.2. Auditoría Detallada de Subsistemas Críticos

#### A. YouTube & Google OAuth 2.0
* **Google OAuth 2.0:** **INEXISTENTE.** No hay endpoint de autorización (`/api/auth/google`), no hay intercambio de `code` por tokens, no hay manejo de `access_token` ni `refresh_token`.
* **Almacenamiento de Tokens:** **INEXISTENTE.** No existe almacén seguro (vault / cifrado AES en base de datos) para credenciales de canal.
* **YouTube Data API v3:** **INEXISTENTE.** No hay dependencias como `googleapis` en `package.json`. No se implementa `videos.insert`, `thumbnails.set`, `playlists.insert` ni gestión de cuotas de YouTube.
* **Modo Demo:** Simulado en [src/server.ts](file:///c:/Users/Glado/CartoonFactory/src/server.ts#L445) devolviendo `channelId: 'UC-KTN-KIDSTOON-STUDIO-DEMO'` y un contador de suscriptores inventado.

#### B. Motor de Inteligencia Artificial (Google GenAI)
* **SDK Utilizado:** `@google/genai` versión `^2.4.0` instanciado en [src/server.ts](file:///c:/Users/Glado/CartoonFactory/src/server.ts#L9).
* **Modelo en Backend:** `gemini-3.8-flash`.
* **API Key:** Leída de `process.env['GEMINI_API_KEY']`.
* **Modo de Operación:**
  1. `POST /api/generate-story`: Recibe parámetros del wizard; envía un prompt de sistema denso solicitando JSON con title, logline, characters y scenes.
  2. `POST /api/generate-character`: Genera fichas de consistencia con paletas y descripciones.
  3. `POST /api/quality-control`: Evalúa story con rol de auditor COPPA y estándares infantiles.
  4. `POST /api/generate-metadata`: Genera títulos, descripciones con timestamps, hashtags y flag COPPA `madeForKids: true`.
* **Fallbacks:** Si no hay API key o si la llamada falla, todos los endpoints retornan estructuras hardcodeadas ("Milo y la Caja de las Sorpresas").
* **Vulnerabilidad (Prompt Injection):** Los inputs del usuario (e.g. `idea`, `title`) se interpolan sin sanitizar directamente en las cadenas de prompt (`USER IDEA: "${idea}"`), permitiendo evasión de directivas del sistema.

#### C. Pipeline Audiovisual (Representación vs Realidad)

```
[ETAPA]          [ESTADO EN CÓDIGO]            [COMPORTAMIENTO REAL]
IDEA             Implementado (UI Wizard)      Guarda texto en signal de memoria.
STORY            Implementado (LLM Real)       Genera JSON de guion mediante Gemini 3.8 Flash.
CHARACTERS       Implementado Parcial          Genera texto de prompts; arte son SVGs fijos.
STORYBOARD       Implementado (UI)             Edición de texto y orden; imágenes son SVGs fijos.
VOICE            MOCK (Web Speech API)         Reproducción en altavoces del browser. No genera archivos.
ANIMATION        MOCK                          Previsualización SVG con animaciones CSS (pan, zoom).
EDITING          MOCK                          Edición de volúmenes en UI. Subtítulos generados por código.
QC               Implementado Parcial          Auditoría textual con Gemini. Cero análisis audiovisual.
THUMBNAIL        MOCK                          Generación procedural de SVG. No exporta imagen ráster.
READY            Estado de UI                  Cambio de flag en memoria.
SCHEDULED        MOCK                          Inserta item en lista de calendario en memoria.
PUBLISHED        MOCK                          Genera IDs falsos ('pub_...', 'yt_...').
```

#### D. Persistencia y Almacenamiento
* **Base de Datos:** **NINGUNA.**
* **Sistemas de Archivos / Assets:** No hay directorio de almacenamiento estructurado para medios (videos, audios, imágenes).
* **Ciclo de Vida:** La totalidad de los proyectos se destruye al cerrar la pestaña o recargar el navegador.

#### E. Renderizado de Vídeo
* **Estado:** **100% SIMULADO.**
* **Detalle:** `Studio.renderVideo()` en [src/app/services/studio.ts](file:///c:/Users/Glado/CartoonFactory/src/app/services/studio.ts#L908) actualiza una barra de progreso porcentual mediante retardos `setTimeout`. No utiliza FFmpeg ni genera un flujo H.264 / AAC en contenedor MP4.

#### F. Seguridad & Producción
* **Secretos:** `GEMINI_API_KEY` se mantiene en el servidor Express, pero sin autenticación de acceso a los endpoints `/api/*`.
* **CORS / CSRF:** No hay configuración de orígenes permitidos ni tokens CSRF.
* **Control Presupuestario:** La UI implementa un modal de confirmación de gasto en euros, pero las llamadas backend no están vinculadas a cuotas reales persistidas en base de datos.

---

## 2. ARQUITECTURA ACTUAL (Baseline de Google AI Studio)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Angular 21)                           │
│                                                                        │
│   App Root Component (Navegación manual vía @switch sobre Signals)     │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ Views: Dashboard, Story, Characters, Storyboard, Voice,         │   │
│   │        Animation, QC, Thumbnail, YouTube, Calendar, Analytics  │   │
│   └───────────────┬───────────────────────────────┬────────────────┘   │
│                   │                               │                    │
│                   ▼                               ▼                    │
│      Studio Service (RAM Signals)     VisualGenerator (SVG inline)     │
│     (Proyectos volátiles en memoria)   (Dibujo procedural de vectores) │
└───────────────────┬────────────────────────────────────────────────────┘
                    │ fetch() llamadas HTTP ad-hoc
                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   BACKEND (Node.js / Express 5.1 SSR)                  │
│                                                                        │
│   [src/server.ts]                                                      │
│   ├── AngularNodeAppEngine (SSR Handler)                               │
│   ├── POST /api/generate-story      ──┐                                │
│   ├── POST /api/generate-character  ──┼──> Google GenAI SDK            │
│   ├── POST /api/quality-control     ──┤    (gemini-3.8-flash)          │
│   ├── POST /api/generate-metadata   ──┘    [Requiere GEMINI_API_KEY]   │
│   ├── GET  /api/youtube/status      ──> [MOCK: Canal Ficticio]         │
│   ├── POST /api/youtube/publish     ──> [MOCK: IDs aleatorios]         │
│   └── GET  /api/cost-summary        ──> [MOCK: Valores en memoria]     │
└────────────────────────────────────────────────────────────────────────┘
                    │                               │
                    ▼                               ▼
       [Google Gemini Developer API]         [BASE DE DATOS / STORAGE]
          (Texto & JSON estructurado)             [TOTALMENTE AUSENTE]
```

---

## 2.5. DOMAIN MODEL — PHASE 01 DISCOVERY

> Documentación exhaustiva complementaria: [docs/PHASE_01_DOMAIN_DESIGN.md](file:///c:/Users/Glado/CartoonFactory/docs/PHASE_01_DOMAIN_DESIGN.md)

### 2.5.1. Análisis y Resolución Semántica: `Series` vs `Project` vs `Episode`
Tras la auditoría forense del prototipo, se determinó que la entidad `Project` en el código de Google AI Studio es un sinónimo directo de **`Episode`**. Cada proyecto modela exactamente una aventura autocontenida de 1 a 5 minutos (guion, personajes, escenas, renderizado de vídeo, metadatos y subida a YouTube).
* **Decisión Canónica:** La jerarquía troncal es **`Series` 1 ── N `Episode`**.
* **`Series` (Universo Narrativo / Franquicia):** Entidad permanente que define las reglas de mundo, estilo visual 3D, edad diana, idioma y personajes maestros recurrentes.
* **`Episode` (Unidad de Producción Audiovisual):** Entidad de ejecución y renderizado que agrupa escenas, diálogos, assets y publicación. En la UI se mantiene la etiqueta *"Proyectos"* para no desorientar al usuario, pero en el dominio técnico y base de datos es formalmente `Episode`.

### 2.5.2. Mapa Canónico de Entidades

| Entity | Purpose | Owner | Relations | Persistent? | Current Location |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **`User`** | Creador / propietario de las producciones. | Root | 1 ── N `Series`, 1 ── N `YouTubeChannel` | Sí | Inexistente (implicado) |
| **`Series`** | Universo narrativo y estilo de franquicia recurrente. | `User` | 1 ── N `Episode`, 1 ── N `Character` (Maestros) | Sí | `studio.ts:32`, `models:150` |
| **`Episode`** | Unidad narrativa y de renderizado (antes `Project`). | `Series` | 1 ── N `Scene`, 1 ── N `Job`, 1 ── 1 `QCReport`, 1 ── 1 `Publication` | Sí | `studio.ts:30`, `models:124` |
| **`Character`** | Biblia técnica de personaje y prompts de consistencia visual. | `Series` / `Episode` | 1 ── 1 `VoiceProfile`, N ── M `Scene` | Sí | `models:23` |
| **`CharacterVoiceProfile`** | Configuración de síntesis vocal (pitch, rate, timbre, voiceId). | `Character` | 1 ── 1 `Character` | Sí | `models:15` |
| **`Scene`** | Bloque audiovisual unitario (visual + audio + texto). | `Episode` | 1 ── N `Asset` (imagen, voz, sfx), N ── M `Character` | Sí | `models:43` |
| **`Asset`** | Archivo multimedia físico gestionado por `StorageProvider`. | `Episode` / `Scene` | 1 ── 1 Referencia física en storage (POSIX / S3) | Sí | `models:190` (`LibraryItem`) |
| **`ProductionJob`** | Tarea pesada asíncrona (Render, TTS, Story Gen, YouTube Upload).| `Episode` | 1 ── N `JobAttempt` | Sí | `studio.ts:34`, `models:163` |
| **`JobAttempt`** | Reintento registrado con trazabilidad de error. | `ProductionJob` | N ── 1 `ProductionJob` | Sí | Inexistente (nuevo) |
| **`QCReport`** | Informe de auditoría pedagógica, coherencia y COPPA. | `Episode` | 1 ── 1 `Episode` | Sí | `models:68` |
| **`YouTubeChannel`** | Canal de YouTube vinculado mediante OAuth 2.0. | `User` | 1 ── N `YouTubePublication`, 1 ── 1 `OAuthCredential` | Sí | `studio.ts:45`, `models:177` |
| **`YouTubeOAuthCredential`**| Tokens de acceso y refresco cifrados (AES-256-GCM). | `YouTubeChannel`| 1 ── 1 `YouTubeChannel` | Sí | Inexistente (hardcoded demo) |
| **`YouTubePublication`** | Publicación, visibilidad (Privada por defecto) y SEO. | `Episode` | N ── 1 `YouTubeChannel`, 1 ── 1 `Episode` | Sí | `models:84` (embebido) |
| **`EditorialCalendarItem`** | Proyección temporal de emisión en calendario editorial. | `Episode` | 1 ── 1 `Episode` | Derivado / Sí | `studio.ts:36`, `models:203` |
| **`CostMetric`** | Registro transaccional de consumo (€, tokens, cómputo). | `Episode` / `Job` | N ── 1 `Episode`, N ── 1 `ProductionJob` | Sí | `models:102` |

### 2.5.3. Límites de Agregados (Aggregate Boundaries)
* **`Series Aggregate`:** `Series` como raíz + Reglas narrativas + Personajes maestros de franquicia.
* **`Episode Aggregate`:** `Episode` como raíz de consistencia + Escenas + Personajes de episodio + Informe QC.
* **`ProductionJob Aggregate`:** `ProductionJob` como raíz + Reintentos (`JobAttempt`) + Trazas de error + Métricas de coste asociadas.
* **`Publication Aggregate`:** `YouTubePublication` como raíz + Metadatos COPPA + Credenciales de canal + Estado en YouTube Data API.

### 2.5.4. Máquinas de Estados Desacopladas
* **`EpisodeStatus` (Editorial):** `DRAFT` ──► `SCRIPTING` ──► `STORYBOARDING` ──► `VOICE_SYNC` ──► `RENDERING` ──► `QC_REVIEW` ──► `APPROVED` ──► `ARCHIVED`
* **`JobStatus` (Técnico / Asíncrono):** `PENDING` ──► `QUEUED` ──► `PROCESSING` ──► `COMPLETED` | `FAILED` | `CANCELLED`
* **`PublicationStatus` (Distribución):** `NOT_CONFIGURED` ──► `METADATA_READY` ──► `SCHEDULED` ──► `UPLOADING` ──► `PUBLISHED_PRIVATE` ──► `PUBLISHED_PUBLIC` | `UPLOAD_FAILED`
* **`SceneAssetStatus`:** `PENDING` | `GENERATING` | `READY` | `FAILED`

### 2.5.5. Matriz de Responsabilidades Backend / Frontend / Worker
* **Frontend (Angular 21 SPA):** Presentación visual, formulario reactivo de wizard, control de reproducción de medios, inspección de timeline y solicitudes de despacho a la API.
* **Backend API (Node Express):** Control de acceso, validación Zod, orquestación de llamadas LLM (Gemini 3.8 Flash), persistencia transaccional PostgreSQL y despacho de Jobs (202 Accepted).
* **Worker Asíncrono (`cartoon-worker`):** Ejecución de FFmpeg (renderizado MP4), llamadas de síntesis vocal (TTS), generación de miniaturas ráster 1280x720 y subidas reanudables a YouTube Data API v3.

### 2.5.6. Propuesta de API REST Canónica (`/api/v1/`)
* **Series:** `GET|POST /api/v1/series`, `GET|PATCH|DELETE /api/v1/series/:id`
* **Episodios:** `GET|POST /api/v1/episodes`, `GET|PATCH|DELETE /api/v1/episodes/:id`
* **Despacho de Jobs (202 Accepted):**
  * `POST /api/v1/episodes/:id/generate-story`
  * `POST /api/v1/episodes/:id/generate-characters`
  * `POST /api/v1/episodes/:id/synthesize-voice`
  * `POST /api/v1/episodes/:id/render`
  * `POST /api/v1/episodes/:id/qc-audit`
* **Jobs:** `GET /api/v1/jobs/:id`, `POST /api/v1/jobs/:id/cancel`
* **YouTube:** `GET /api/v1/youtube/channels`, `POST /api/v1/youtube/oauth/start`, `GET /api/v1/youtube/oauth/callback`, `POST /api/v1/episodes/:id/publish`
* **Costes & Métricas:** `GET /api/v1/costs/summary`, `GET /api/v1/analytics/overview`

### 2.5.7. Propuesta de Routing Angular Canónico
* `/dashboard`
* `/series`
* `/episodes` (Listado de producciones)
* `/episodes/:id/story`
* `/episodes/:id/characters`
* `/episodes/:id/storyboard`
* `/episodes/:id/voice`
* `/episodes/:id/animation` (Timeline & Render)
* `/episodes/:id/qc`
* `/episodes/:id/thumbnail`
* `/episodes/:id/publish`
* `/calendar`, `/analytics`, `/library`, `/settings`

### 2.5.8. Propuesta de Base de Datos Relacional Definitiva (PostgreSQL / Prisma)
Esquema formal de **20 tablas físicas normalizadas en 3ª Forma Normal** (cerrado en Phase 01.2):
`users`, `series`, `character_definitions`, `character_voice_profiles`, `episodes`, `episode_characters`, `scenes`, `assets`, `asset_versions`, `episode_versions`, `production_jobs`, `job_steps`, `provider_executions`, `qc_reports`, `qc_checks`, `editorial_calendar_items`, `google_oauth_accounts`, `youtube_channels`, `youtube_channel_connections`, `youtube_publications`.

### 2.5.9. Fronteras de Seguridad & Privacidad Infantil (COPPA)
1. **Tokens OAuth encriptados:** Cifrado simétrico AES-256-GCM para credenciales de Google/YouTube en backend (`google_oauth_accounts`).
2. **COPPA Inmutable:** `madeForKids: true` forzado a nivel de base de datos y esquema.
3. **Visibilidad Privada Obligatoria:** Publicación predeterminada en `PRIVATE` para revisión humana obligatoria en YouTube Studio.
4. **Validación Zod estricta:** Filtrado y validación de respuestas LLM antes de persistencia.

### 2.5.10. Cierre Definitivo de Dominio (Phase 01.2)
> Documento exhaustivo: [docs/PHASE_01_2_DOMAIN_CLOSURE.md](file:///c:/Users/Glado/CartoonFactory/docs/PHASE_01_2_DOMAIN_CLOSURE.md)
1. **YouTube & OAuth:** `GoogleOAuthAccount ──► YouTubeChannelConnection ──► YouTubeChannel` (conexión M:N que permite múltiples cuentas Google autorizando el mismo canal de YouTube; refresh tokens exclusivamente en backend).
2. **EpisodeStatus Canónico:** `DRAFT` ──► `READY_FOR_PRODUCTION` ──► `IN_PRODUCTION` ──► `READY_FOR_REVIEW` ──► `APPROVED` ──► `ARCHIVED` (desacoplado formalmente de los pasos técnicos de `ProductionJob`).
3. **Calendario Editorial:** `editorial_calendar_items` como tabla física de **intención editorial** (`planned_at`, `timezone`, `editorial_status`, `notes`) separada de `YouTubePublication`.
4. **Inventario Cerrado:** 20 tablas físicas exactas. `CostMetric` eliminada como tabla física y consolidada en `provider_executions`.
5. **EpisodeVersion:** Formulado técnicamente como *immutable production snapshot / reproducible input state* (asumiendo la naturaleza estocástica de los LLMs/difusión).
6. **JobStep Idempotente:** Reanudación segura de pasos basada en `input_hash: VARCHAR(64)` (SHA-256 del payload de entrada de cada subtarea).
7. **Control de Calidad (QC):** Aprobación gobernada por 0 fallos críticos en reglas atómicas (`QCCheck`); eliminación de engagement del núcleo de QC.
8. **ProviderExecution:** Telemetría técnica separada de contabilidad con `cost_eur` nullable (para operaciones gratuitas o cuotas incluidas).

---

## 3. ARQUITECTURA OBJETIVO (Server-First / Production-Ready)

```
                                [INTERNET / CLIENTES]
                                          │
                                          ▼
                   ┌─────────────────────────────────────────────┐
                   │    REVERSE PROXY (cartoon-proxy / Nginx)    │
                   │    - SSL / TLS Termination                  │
                   │    - Gzip / Brotli compression              │
                   │    - Rate Limiting / DDoS mitigation        │
                   └──────────────┬───────────────┬──────────────┘
                                  │               │
            / (Static + SSR)      │               │ /api/* (REST + WebSocket)
                                  ▼               ▼
           ┌─────────────────────────────┐ ┌────────────────────────────────────────┐
           │  FRONTEND (cartoon-web)     │ │        API CORE (cartoon-api)          │
           │  - Angular 21 SPA           │ │  - Express 5.1 con TypeScript estricto │
           │  - Angular Router canónico  │ │  - Auth Middleware (JWT / Cookies)     │
           │  - Reprod. MP4/HLS HTML5    │ │  - Validación Zod en todas las entradas│
           │  - Signals + HTTP Client    │ │  - YouTube OAuth 2.0 Controller        │
           └─────────────────────────────┘ │  - Job Dispatcher (Asynchronous)       │
                                           └───────┬─────────────┬──────────┬───────┘
                                                   │             │          │
                                      State / Jobs │             │ Assets   │ Media
                                                   ▼             ▼          ▼
                           ┌─────────────────────────────┐ ┌────────────────────────┐
                           │    DATABASE (postgres)      │ │ STORAGE (storage)      │
                           │  - PostgreSQL 16            │ │ - MinIO (Dev) / S3     │
                           │  - Prisma ORM Schema        │ │ - StorageProvider API  │
                           │  - Transacciones ACID       │ │ - MP4, WAV, PNG, VTT   │
                           │  - Tokens cifrados AES-256  │ │ - Zero hardcoded paths │
                           │  - Tabla Jobs & Status      │ └────────┬───────────────┘
                           └──────────────┬──────────────┘          │
                                          │                         │ Read / Write
                                          │ Consume Jobs            │ Media Assets
                                          ▼                         │
                           ┌────────────────────────────────────────┴───────────────┐
                           │              WORKER (cartoon-worker)                   │
                           │  - Proceso en background desacoplado                   │
                           │  - FFmpeg nativo (ensamblado de vídeo, audio y VTT)    │
                           │  - TTS Engine (síntesis de voces a archivos WAV reales)│
                           │  - AI Orchestrator (Gemini 3.8 Flash structured calls) │
                           │  - YouTube Data API v3 Uploader (Resumable Uploads)    │
                           │  - QC Verifier (Audio Drift & Sync Check < 0.05s)      │
                           └────────────────────────────────────────────────────────┘
```

---

## 4. GAP ANALYSIS (Estado Actual vs Arquitectura Server-First)

| Dimensión | Estado Actual (Baseline) | Estado Objetivo (Server-First) | Brecha Principal a Cerrar |
| :--- | :--- | :--- | :--- |
| **Infraestructura** | Monolito Node local en Windows. | Contenedores Docker Compose (`web`, `api`, `worker`, `postgres`, `storage`). | Modularizar servicios e independizar el worker. |
| **Persistencia** | RAM Signals volátil (F5 borra todo). | PostgreSQL 16 con Prisma ORM transaccional. | Diseñar schema Prisma y persistir todo el modelo de datos. |
| **Storage** | Ninguno. SVGs en strings TypeScript. | Abstracción `StorageProvider` (`LocalStorageProvider` / `S3Provider`). | Implementar storage provider desacoplado de rutas Windows. |
| **Enrutamiento** | `@switch` en componente raíz `App`. | Angular Router canónico (`/projects/:id/story`, etc.). | Implementar `app.routes.ts` y desacoplar vistas. |
| **Voz / Audio** | Web Speech API cliente (no graba). | Worker genera archivos WAV/MP3 persistentes en Storage. | Integrar motor TTS backend con sincronización temporal. |
| **Imágenes / Arte** | Código SVG estático en TS. | Generador visual ráster (PNG/JPG) almacenado en Storage. | Implementar pipeline de generación visual persistente. |
| **Render de Vídeo** | 3 `setTimeout` en frontend. | `cartoon-worker` ejecuta FFmpeg y genera MP4 real. | Implementar motor de renderizado FFmpeg asíncrono. |
| **Control Calidad** | Evaluación textual por LLM. | Doble verificación: Drift numérico (<0.05s) + LLM COPPA. | Integrar validador determinista probado en Phase 1A. |
| **YouTube OAuth** | Tarjeta de estado simulada. | Google OAuth 2.0 real con tokens cifrados en Postgres. | Implementar flujo OAuth 2.0 y renovación automática. |
| **YouTube Upload** | Generador de IDs ficticios. | Subida reanudable vía YouTube Data API v3 (`videos.insert`). | Integrar SDK oficial `googleapis` en `cartoon-worker`. |
| **Scheduler** | Cuadrícula estética. | Worker programador que monitoriza fechas y dispara jobs. | Implementar motor de colas/jobs persistido en DB. |
| **Analytics** | Cifras hardcodeadas en HTML. | Ingesta real desde YouTube Analytics API. | Conectar endpoints con métricas reales de YouTube. |

---

## 5. ROADMAP DE IMPLEMENTACIÓN POR FASES

### PHASE 00 — Baseline Setup & Server-First Hygiene
* **Objetivo:** Asegurar compilación limpia, variables de entorno tipadas y configuración de paridad dev/prod sin tocar funcionalidades existentes.
* **Entregables:**
  * Archivo de variables de entorno `.env.example` completo.
  * Validador de entorno en arranque del servidor (`zod` para env vars).
  * Puerto configurable libre de colisiones (prohibidos 3000 y 5000 en Windows).

### PHASE 01 — Architecture & Routing Refactoring
* **Objetivo:** Desacoplar la vista monolítica de `App` e implementar Angular Router canónico y un `ApiClient` centralizado.
* **Entregables:**
  * [src/app/app.routes.ts](file:///c:/Users/Glado/CartoonFactory/src/app/app.routes.ts) con rutas profundas (`/dashboard`, `/projects`, `/projects/:id/story`, `/projects/:id/render`, etc.).
  * `ApiClient` Angular usando `HttpClient` con interceptores para llamadas REST limpias.

### PHASE 02 — PostgreSQL Database & Persistence Engine
* **Objetivo:** Dotar al sistema de persistencia relacional con PostgreSQL desde el inicio.
* **Entregables:**
  * Configuración de PostgreSQL (Docker Compose local para dev).
  * `prisma/schema.prisma` modelando: `User`, `Series`, `Project`, `Character`, `Scene`, `Job`, `YouTubeCredential`, `CostMetric`.
  * Migraciones ejecutadas y repositorios de datos en `src/server/db/*`.
  * Cero pérdida de datos tras F5 o reinicio de servidor.

### PHASE 03 — Authentication & Multi-Tenant Security
* **Objetivo:** Proteger el backend y aislar datos por usuario o tenant.
* **Entregables:**
  * Autenticación con JWT en cookies HttpOnly seguras.
  * Hashing de credenciales con Argon2.
  * Middleware de autorización en todos los endpoints `/api/*`.

### PHASE 04 — Robust AI Generation & Prompt Hardening
* **Objetivo:** Blindar el pipeline de Gemini 3.8 Flash contra prompt injections y garantizar salidas estructuradas estrictas.
* **Entregables:**
  * Validación Zod en backend para el 100% de las respuestas de IA.
  * Sanitización estricta de parámetros de entrada.
  * Trazabilidad de tokens y costes en euros persistida en la tabla `CostMetric`.

### PHASE 05 — StorageProvider Abstraction Engine
* **Objetivo:** Implementar la capa agnóstica de almacenamiento para todos los medios.
* **Entregables:**
  * Interfaz `StorageProvider` en `src/server/storage/`.
  * Implementación `LocalStorageProvider` (rutas relativas POSIX, cero `C:\Users...`).
  * Implementación `S3CompatibleStorageProvider` para producción.
  * Endpoints seguros para servir y firmar URLs de assets.

### PHASE 06 — Real Voice & Audio Pipeline
* **Objetivo:** Sustituir la simulación Web Speech por síntesis vocal real que genere archivos físicos de audio.
* **Entregables:**
  * Conector TTS en `cartoon-worker` (Google Cloud TTS o motor local).
  * Generación y almacenamiento de archivos `.wav` por escena en el `StorageProvider`.
  * Cálculo de duraciones exactas y generación de pistas de diálogo alineadas.

### PHASE 07 — Visual Generation & Storyboard Pipeline
* **Objetivo:** Sustituir los SVGs sintéticos por imágenes ráster reales de alta resolución (16:9).
* **Entregables:**
  * Pipeline generativo visual en worker almacenando imágenes `.png` en `StorageProvider`.
  * Mantener consistencia visual de personajes mediante seeds y prompts maestros.

### PHASE 08 — Real Video Rendering Engine (FFmpeg Worker)
* **Objetivo:** Eliminar la simulación `setTimeout` e implementar el renderizado físico de vídeo dentro del Worker.
* **Entregables:**
  * Motor FFmpeg en `cartoon-worker` que ensambla fotogramas visuales, diálogo, música de fondo y subtítulos WebVTT.
  * Generación de archivo final `MP4 (H.264 / AAC, 1080p)` guardado en `StorageProvider`.
  * Flujo asíncrono no bloqueante: la API devuelve `202 Accepted` y el cliente consulta progreso mediante SSE o polling al Job.

### PHASE 09 — Objective Quality Control (Audio Drift & COPPA Checks)
* **Objetivo:** Implementar la validación determinista demostrada en Phase 1A.2-D.
* **Entregables:**
  * Análisis de desincronización: verificación de que `abs(audio_duration - video_duration) <= 0.05s`.
  * Bloqueo automático del proyecto (`status='BLOCKED'`) si se detecta drift o violación COPPA.

### PHASE 10 — Real YouTube Integration (OAuth 2.0 & Data API v3)
* **Objetivo:** Reemplazar el mock de canal por integración oficial con Google YouTube Studio.
* **Entregables:**
  * Flujo Google OAuth 2.0 completo con consent screen y almacenamiento cifrado de `refresh_token` en PostgreSQL con AES-256-GCM.
  * Servicio de subida reanudable vía YouTube Data API v3 (`videos.insert`) con clasificación `madeForKids: true` y visibilidad **PRIVADA obligatoria**.

### PHASE 11 — Background Scheduler & Worker Queues
* **Objetivo:** Automatizar la ejecución diferida de trabajos y publicaciones programadas.
* **Entregables:**
  * Motor de jobs desacoplado en `cartoon-worker` respaldado por PostgreSQL.
  * Tarea periódica que monitoriza el calendario editorial y dispara publicaciones a la hora programada.

### PHASE 12 — End-to-End Automation Loop
* **Objetivo:** Enlazar el ciclo completo autónomo: Idea → Guion → Voces → Render → QC → Metadatos → Publicación privada en YouTube.
* **Entregables:** Orquestador de pipeline capaz de ejecutar el ciclo completo con un solo trigger y guardarraíles de seguridad.

### PHASE 13 — Live Analytics & Channel Intelligence
* **Objetivo:** Conectar el panel de Analytics con la API real de YouTube Analytics.
* **Entregables:** Ingesta y almacenamiento en PostgreSQL de visualizaciones reales, tiempo de reproducción y retención infantil.

### PHASE 14 — Security Hardening, Dockerization & Remote Deployment
* **Objetivo:** Preparación final para el despliegue en servidor remoto.
* **Entregables:**
  * `docker-compose.yml` completo con perfiles dev y prod.
  * Dockerfiles optimizados multi-stage para `cartoon-web`, `cartoon-api` y `cartoon-worker`.
  * Configuración Nginx reverse proxy con headers de seguridad y compresión.

---

## 6. DEPENDENCIAS TÉCNICAS POR FASE (Server-First Matrix)

| Fase | Servicios / Contenedores Afectados | Archivos Clave | Dependencias / Herramientas | Variables de Entorno |
| :--- | :--- | :--- | :--- | :--- |
| **00** | `cartoon-api`, `cartoon-web` | `package.json`, `.env.example` | `dotenv`, `zod`, `cross-env` | `PORT`, `NODE_ENV` |
| **01** | `cartoon-web` | `src/app/app.routes.ts`, `services/api-client.ts` | Angular Router, `provideHttpClient` | `API_BASE_URL` |
| **02** | `cartoon-api`, `postgres` | `prisma/schema.prisma`, `src/server/db/*` | `prisma`, `@prisma/client`, PostgreSQL 16 | `DATABASE_URL` |
| **03** | `cartoon-api` | `src/server/auth/*`, `src/app/guards/*` | `argon2`, `jsonwebtoken`, `cookie-parser` | `JWT_SECRET`, `SESSION_SECRET` |
| **04** | `cartoon-api`, `cartoon-worker` | `src/server/ai/*`, `schemas/ai.schemas.ts` | `@google/genai`, `zod` | `GEMINI_API_KEY` |
| **05** | `cartoon-api`, `cartoon-worker`, `storage` | `src/server/storage/*` | `@aws-sdk/client-s3` (para S3 driver) | `STORAGE_DRIVER`, `STORAGE_LOCAL_PATH`, `S3_*` |
| **06** | `cartoon-worker` | `src/server/audio/*`, `src/server/jobs/voice.ts` | `@google-cloud/text-to-speech` o HTTP client | `TTS_API_KEY`, `TTS_PROVIDER` |
| **07** | `cartoon-worker` | `src/server/visuals/*` | Sharp, HTTP client | `IMAGE_GEN_API_KEY` |
| **08** | `cartoon-worker` | `src/server/render/*`, `src/server/jobs/render.ts` | `fluent-ffmpeg`, Binario FFmpeg | `FFMPEG_PATH` |
| **09** | `cartoon-worker` | `src/server/qc/*` | `zod` | Ninguna extra |
| **10** | `cartoon-api`, `cartoon-worker` | `src/server/youtube/*` | `googleapis` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI` |
| **11** | `cartoon-worker`, `postgres` | `src/server/scheduler/*`, `src/server/jobs/*` | PostgreSQL Job Queue / Worker Runner | `JOB_POLL_INTERVAL_MS` |
| **12** | `cartoon-worker` | `src/server/pipeline/orchestrator.ts` | Ninguna extra | Ninguna extra |
| **13** | `cartoon-api` | `src/server/analytics/*` | `googleapis` | Ninguna extra |
| **14** | Todos (`web`, `api`, `worker`, `proxy`) | `Dockerfile.*`, `docker-compose.yml`, `nginx.conf` | Docker Engine, Nginx, Helmet | `CORS_ORIGIN`, `VIRTUAL_HOST`, `LETSENCRYPT_HOST` |

---

## 7. CRITERIOS DE ACEPTACIÓN POR FASE

* **PHASE 00:** Servidor arranca y valida las variables de entorno sin warning crítico. El puerto está aislado y no colisiona con servicios del sistema.
* **PHASE 01:** Navegación profunda en Angular SPA (`/projects/:id/story`) funcional con URL canónica sin pasar por `@switch`.
* **PHASE 02:** Se crea un proyecto en PostgreSQL vía Prisma, se reinicia el contenedor/servidor y los datos se conservan íntegros.
* **PHASE 03:** Peticiones no autenticadas devuelven `401 Unauthorized`. Los proyectos pertenecen a un usuario y están aislados.
* **PHASE 04:** Las respuestas de Gemini son parseadas y validadas por Zod; entradas con prompt injection no alteran el esquema del guion.
* **PHASE 05:** `StorageProvider` sube y recupera archivos utilizando rutas relativas normalizadas (POSIX) o S3, sin rastro de `C:\Users...`.
* **PHASE 06:** El Worker produce archivos `.wav` reales de cada diálogo que se almacenan en `StorageProvider` y se reproducen en el cliente.
* **PHASE 07:** Las escenas cuentan con archivos de imagen ráster reales generados y vinculados en el modelo de base de datos.
* **PHASE 08:** Al solicitar el render, la API responde inmediatamente `202 Accepted { jobId }`. El Worker ejecuta FFmpeg y produce un archivo físico `.mp4` con vídeo, audio y subtítulos incrustados, almacena en `StorageProvider` y marca el job como `completed`.
* **PHASE 09:** El sistema verifica que el drift temporal entre pista de audio y vídeo sea $\le 0.05$s. Si excede, aborta la publicación.
* **PHASE 10:** El usuario se autentica con Google OAuth 2.0 y al presionar "Subir a YouTube", el vídeo aparece en su canal real de YouTube Studio en estado **PRIVADO**.
* **PHASE 11:** El worker del scheduler publica automáticamente en YouTube un episodio programado al llegar su hora sin intervención manual.
* **PHASE 12:** El pipeline completo desde Idea hasta YouTube se ejecuta de forma desatendida y determinista.
* **PHASE 13:** El panel de Analytics consume datos reales de YouTube Analytics API.
* **PHASE 14:** `docker compose up --build` levanta la suite completa (`reverse-proxy`, `cartoon-web`, `cartoon-api`, `cartoon-worker`, `postgres`, `storage`) y pasa healthchecks en un servidor Linux limpio.

---

## 8. MATRIZ DE RIESGOS TÉCNICOS & ARQUITECTÓNICOS

| Riesgo | Probabilidad | Impacto | Mitigación Arquitectónica |
| :--- | :---: | :---: | :--- |
| **Agotamiento de Cuota YouTube API** (10,000 unidades/día; `videos.insert` = 1,600 unidades) | Alta | Crítico | Cola de publicación con rate limiting (máximo 5 vídeos/día por cuenta). Subidas reanudables para evitar fallos costosos. |
| **Bloqueo del Event Loop por Renderizado** | Alta | Crítico | FFmpeg aislado en `cartoon-worker`, ejecutado como proceso hijo con control de CPU/memoria independiente de la API. |
| **Acoplamiento al Sistema Operativo Local (Windows vs Linux)** | Media | Crítico | Abstracción obligatoria `StorageProvider` con rutas POSIX normalizadas y ejecución en contenedores Docker. |
| **Desincronización Audiovisual (Audio Drift)** | Media | Alto | Verificación obligatoria de drift en Phase 09 y multiplexado forzado con filtros FFmpeg (`atempo` / `setpts`). |
| **Violación Involuntaria de Políticas COPPA** | Baja | Catastrófico | Forzar por diseño: `madeForKids: true`, desactivación de comentarios y visibilidad **PRIVADA por defecto**. |
| **Pérdida de Trabajos Asíncronos ante Caídas** | Media | Alto | Estados de Jobs persistidos en PostgreSQL (`queued`, `processing`, `completed`, `failed`) con recuperación automática al reiniciar el Worker. |

---

## 9. REGISTRO DE DECISIONES TÉCNICAS (ADR)

* **ADR-01 [ZANJADA]: Motor de Base de Datos → PostgreSQL 16 con Prisma ORM.**
  * *Decisión:* PostgreSQL desde el inicio. No SQLite. Asegura paridad dev/prod total y soporte concurrente para jobs y estados.
* **ADR-02 [ZANJADA]: Arquitectura de Procesamiento → Worker Asíncrono Desacoplado (`cartoon-worker`).**
  * *Decisión:* La API Express solo despacha jobs y responde de inmediato. FFmpeg, TTS y uploads corren en el worker.
* **ADR-03 [ZANJADA]: Almacenamiento de Assets → Abstracción `StorageProvider`.**
  * *Decisión:* Cero rutas absolutas de Windows. `LocalStorageProvider` para desarrollo y `S3CompatibleStorageProvider` para producción.
* **ADR-04 [ZANJADA]: Renderizado de Vídeo → FFmpeg Nativo en Worker.**
  * *Decisión:* FFmpeg en worker para rendimiento óptimo, bajo consumo de memoria y determinismo mecánico.
* **ADR-05 [PENDIENTE DE PREFERENCIA DE PROVEEDOR]: Síntesis Vocal (TTS):**
  * *Opción recomendada:* **Google Cloud Text-to-Speech** (Neural2 / Journey Kids voices) por latencia, coste y consistencia con el stack de Google.

---

## 10. AUDITORÍA DE RESPONSABILIDADES CLIENTE / SERVIDOR (Hallazgos Phase 00)

Durante la Phase 00 se detectó lógica de negocio crítica que actualmente reside de forma errónea en el cliente Angular y que deberá ser migrada progresivamente al backend:

| Lógica Detectada en Angular | Ubicación Actual | Destino Arquitectónico Objetivo | Fase de Migración |
| :--- | :--- | :--- | :--- |
| **Generación de Subtítulos (SRT / VTT)** | `src/app/services/studio.ts:521` | `cartoon-worker` o servicio de escenas en backend al persistir diálogos. | PHASE 06 / 08 |
| **Contabilidad de Tokens y Presupuestos** | `src/app/services/studio.ts:71` | Tabla `CostMetric` en PostgreSQL y middleware de verificación en API. | PHASE 02 / 04 |
| **Orquestación de Progreso de Jobs** | `src/app/services/studio.ts:908` | Tabla `Job` en PostgreSQL y polling / SSE hacia `cartoon-worker`. | PHASE 08 / 11 |
| **Generación de Miniaturas 1280x720** | `src/app/services/visual-generator.ts:220` | Worker ráster (Sharp) que genere PNG/JPG reales en `StorageProvider`. | PHASE 07 / 08 |
| **Generación de IDs Primarios** | `src/app/services/studio.ts:594` | IDs canónicos (UUID v4 / CUID) generados por PostgreSQL / Prisma. | PHASE 02 |

---

## 11. ESTADO DE EJECUCIÓN DEL ROADMAP

* **[x] PHASE 00 — SERVER-FIRST HYGIENE (COMPLETADA)**
  * [x] Cero rutas absolutas de Windows en runtime.
  * [x] Configuración centralizada tipada en `src/server/config/index.ts`.
  * [x] `.env.example` estructurado y sin secretos.
  * [x] Logging estructurado (`logger.ts`) con sanitización de credenciales.
  * [x] Jerarquía de errores backend (`AppError`, `errorHandler`).
  * [x] Mocks y datos demo catalogados como `DEMO_ONLY`.
  * [x] Interfaz `StorageProvider` y `LocalStorageProvider` relativo.
  * [x] Interfaces de proveedores base (`AIProvider`, `TTSProvider`, `ImageProvider`, `YouTubeProvider`).
  * [x] Compilación limpia de Angular y SSR (`npm run build` exitoso).
* **[x] PHASE 01 — DOMAIN & ARCHITECTURE DISCOVERY (COMPLETADA A NIVEL DE DISEÑO)**
  * [x] Auditoría forense del modelo de datos de Google AI Studio y resolución semántica (`Series` ──► `Episode`).
  * [x] Mapa de entidades canónicas, cardinalidades y límites de agregados.
  * [x] Máquinas de estados desacopladas (`EpisodeStatus`, `JobStatus`, `PublicationStatus`, `SceneAssetStatus`).
  * [x] Especificación técnica base en [docs/PHASE_01_DOMAIN_DESIGN.md](file:///c:/Users/Glado/CartoonFactory/docs/PHASE_01_DOMAIN_DESIGN.md).
* **[x] PHASE 01.1 — DOMAIN MODEL REFINEMENT (COMPLETADA A NIVEL DE DISEÑO)**
  * [x] Refinamiento de 10 puntos de diseño en [docs/PHASE_01_1_DOMAIN_REFINEMENT.md](file:///c:/Users/Glado/CartoonFactory/docs/PHASE_01_1_DOMAIN_REFINEMENT.md).
* **[x] PHASE 01.2 — DOMAIN ARCHITECTURE CLOSURE (CIERRE DEFINITIVO DE DOMINIO)**
  * [x] Cierre de 8 puntos críticos en [docs/PHASE_01_2_DOMAIN_CLOSURE.md](file:///c:/Users/Glado/CartoonFactory/docs/PHASE_01_2_DOMAIN_CLOSURE.md).
  * [x] Modelo M:N `GoogleOAuthAccount ──► YouTubeChannelConnection ──► YouTubeChannel`.
  * [x] `EpisodeStatus` canónico editorial desacoplado de las etapas de worker/jobs.
  * [x] `editorial_calendar_items` mantenida como tabla física de intención editorial.
  * [x] Inventario formal cerrado en 20 tablas físicas (eliminación de `CostMetric` en favor de `provider_executions`).
  * [x] Formulación rigurosa de `EpisodeVersion` como *reproducible input state*.
  * [x] Idempotencia y reanudabilidad de `JobStep` garantizada por `input_hash: VARCHAR(64)`.
  * [x] Rediseño de control de calidad: aprobación basada en 0 fallos críticos en `QCCheck` y exclusión de engagement.
  * [x] `ProviderExecution` con `cost_eur` nullable y separación de telemetría de contabilidad.
* **[x] PHASE 02 — POSTGRESQL & PERSISTENCE ENGINE (COMPLETADA)**
  * [x] Instalación de `prisma@6.4.1` y `@prisma/client@6.4.1` con integración en scripts de `package.json`.
  * [x] Modelado e implementación del esquema canónico definitivo de 20 tablas físicas en [prisma/schema.prisma](file:///c:/Users/Glado/CartoonFactory/prisma/schema.prisma).
  * [x] Validación sintáctica y referencial exitosa (`prisma validate` OK).
  * [x] Generación del cliente Prisma fuertemente tipado (`prisma generate` OK).
  * [x] Cliente singleton con logging estructurado y protección SSR en [src/server/db/client.ts](file:///c:/Users/Glado/CartoonFactory/src/server/db/client.ts).
  * [x] Definición de servicio PostgreSQL 16 en [docker-compose.yml](file:///c:/Users/Glado/CartoonFactory/docker-compose.yml).
  * [x] Script de seed con datos maestros en [prisma/seed.ts](file:///c:/Users/Glado/CartoonFactory/prisma/seed.ts).
  * [x] Endpoint de salud y diagnóstico de base de datos en `GET /api/health/db`.
* **[x] PHASE 03 — SECURITY, AUTH & MULTI-TENANCY (COMPLETADA)**
  * [x] Autenticación JWT HS256 con separación estricta access/refresh y validación de secret >= 32 chars.
  * [x] Hashing seguro de contraseñas con Argon2id y defensa contra timing attacks.
  * [x] Rotación atómica de refresh tokens en base de datos (`familyId` con mitigación de replay attack).
  * [x] Cookies `HttpOnly`, `SameSite=Strict`, `Secure` (prod) y soporte de header `Bearer`.
  * [x] Middleware global `requireAuth` protegiendo todos los endpoints mutantes y legacy en `/api/*`.
  * [x] Suite formal de 34 pruebas en `src/server/auth/auth.security.spec.ts` (100% pass).
  * [x] Reporte de auditoría técnica en [docs/PHASE_03_1_SECURITY_AUDIT.md](file:///c:/Users/Glado/CartoonFactory/docs/PHASE_03_1_SECURITY_AUDIT.md).
* **[x] PHASE 04 — ROBUST AI GENERATION & PROMPT HARDENING (COMPLETADA)**
  * [x] Validación Zod al 100% para todas las entradas y salidas de modelos de IA ([src/server/ai/schemas.ts](file:///c:/Users/Glado/CartoonFactory/src/server/ai/schemas.ts)).
  * [x] Sanitización estricta de prompts contra inyecciones, delimitadores, tokens especiales y caracteres BiDi ([src/server/ai/sanitizer.ts](file:///c:/Users/Glado/CartoonFactory/src/server/ai/sanitizer.ts)).
  * [x] Calculadora de costes en Euros (EUR) con precisión IEEE 754 de 6 decimales ([src/server/ai/cost.calculator.ts](file:///c:/Users/Glado/CartoonFactory/src/server/ai/cost.calculator.ts)).
  * [x] Telemetría y trazabilidad de tokens persistida en `provider_executions` con hash SHA-256 ([src/server/ai/telemetry.service.ts](file:///c:/Users/Glado/CartoonFactory/src/server/ai/telemetry.service.ts)).
  * [x] Servicio desacoplado `GeminiService` con guardarraíles COPPA y fallback de alta fidelidad ([src/server/ai/gemini.service.ts](file:///c:/Users/Glado/CartoonFactory/src/server/ai/gemini.service.ts)).
  * [x] Enrutador Express modular `aiRouter` montado en [src/server.ts](file:///c:/Users/Glado/CartoonFactory/src/server.ts).
  * [x] Suite de 31 pruebas de seguridad y robustez en [src/server/ai/ai.security.spec.ts](file:///c:/Users/Glado/CartoonFactory/src/server/ai/ai.security.spec.ts) (65 tests globales pasando).
  * [x] Documentación de arquitectura en [docs/PHASE_04_ROBUST_AI_GENERATION.md](file:///c:/Users/Glado/CartoonFactory/docs/PHASE_04_ROBUST_AI_GENERATION.md).
* **[x] PHASE 05 — STORAGEPROVIDER ABSTRACTION ENGINE (COMPLETADA)**
  * [x] Interfaz unificada `StorageProvider` desacoplada del filesystem Windows ([src/server/storage/storage.interface.ts](file:///c:/Users/Glado/CartoonFactory/src/server/storage/storage.interface.ts)).
  * [x] Sanitizador de claves POSIX y blindaje contra path traversal, null bytes y prefijos de unidad ([src/server/storage/path.sanitizer.ts](file:///c:/Users/Glado/CartoonFactory/src/server/storage/path.sanitizer.ts)).
  * [x] Utilidades ligeras para tipos MIME y streaming por rangos HTTP 206 ([src/server/storage/mime.utils.ts](file:///c:/Users/Glado/CartoonFactory/src/server/storage/mime.utils.ts)).
  * [x] Módulo de firmado criptográfico de URLs con HMAC-SHA256, TTL y defensa contra timing attacks ([src/server/storage/signer.ts](file:///c:/Users/Glado/CartoonFactory/src/server/storage/signer.ts)).
  * [x] Implementación `LocalStorageProvider` con confinamiento estricto de directorio y cero rutas absolutas ([src/server/storage/local.storage.ts](file:///c:/Users/Glado/CartoonFactory/src/server/storage/local.storage.ts)).
  * [x] Implementación `S3CompatibleStorageProvider` con motor nativo AWS SigV4 y presigned URLs sin librerías pesadas ([src/server/storage/s3.storage.ts](file:///c:/Users/Glado/CartoonFactory/src/server/storage/s3.storage.ts)).
  * [x] Factoría y singleton para conmutación fluida vía `STORAGE_DRIVER=local|s3` ([src/server/storage/storage.factory.ts](file:///c:/Users/Glado/CartoonFactory/src/server/storage/storage.factory.ts)).
  * [x] Router Express `storageRouter` con endpoints públicos de streaming (`GET /*key`, `GET /signed`) y autenticados (`POST /upload`, `POST /sign`, `DELETE /*key`) montado en [src/server.ts](file:///c:/Users/Glado/CartoonFactory/src/server.ts).
  * [x] Suite de 40 pruebas en [src/server/storage/storage.spec.ts](file:///c:/Users/Glado/CartoonFactory/src/server/storage/storage.spec.ts) (105 tests globales pasando al 100%).
  * [x] Informe técnico de arquitectura en [docs/PHASE_05_STORAGE_PROVIDER_ENGINE.md](file:///c:/Users/Glado/CartoonFactory/docs/PHASE_05_STORAGE_PROVIDER_ENGINE.md).
* **[x] PHASE 06 — REAL VOICE & AUDIO PIPELINE (COMPLETADA)**
  * [x] Motor mecánico RIFF/WAVE PCM de 44 bytes y analizador binario de duraciones en microsegundos ([src/server/audio/wav.utils.ts](file:///c:/Users/Glado/CartoonFactory/src/server/audio/wav.utils.ts)).
  * [x] Sintetizador determinista de ondas de voz multifórmicas para desarrollo offline y testing sin dependencias externas ([src/server/audio/wav.utils.ts](file:///c:/Users/Glado/CartoonFactory/src/server/audio/wav.utils.ts)).
  * [x] Catálogo canónico de presets vocales preescolares con Neural2/Journey ([src/server/audio/voice.catalog.ts](file:///c:/Users/Glado/CartoonFactory/src/server/audio/voice.catalog.ts)).
  * [x] Proveedor Google Cloud Text-to-Speech con modulación de tono en semitonos y fallback resiliente ([src/server/audio/google-tts.provider.ts](file:///c:/Users/Glado/CartoonFactory/src/server/audio/google-tts.provider.ts)).
  * [x] Generador de subtítulos WebVTT (`.vtt`) y SubRip (`.srt`) con alineación temporal milimétrica y cálculo de drift ([src/server/audio/subtitle.generator.ts](file:///c:/Users/Glado/CartoonFactory/src/server/audio/subtitle.generator.ts)).
  * [x] Orquestador de síntesis `VoicePipelineService` con subida a `StorageProvider` y telemetría de costes en PostgreSQL ([src/server/audio/voice.service.ts](file:///c:/Users/Glado/CartoonFactory/src/server/audio/voice.service.ts)).
  * [x] Router Express `voiceRouter` (`/catalog`, `/test`, `/scene`, `/batch`) con protección JWT y montado en [src/server.ts](file:///c:/Users/Glado/CartoonFactory/src/server.ts).
  * [x] Integración en frontend Angular (`Studio` service & `VoiceView`) con reproductor HTML5 real y badges de estado ([src/app/components/voice-view.ts](file:///c:/Users/Glado/CartoonFactory/src/app/components/voice-view.ts)).
  * [x] Suite de 28 pruebas exhaustivas en [src/server/audio/audio.spec.ts](file:///c:/Users/Glado/CartoonFactory/src/server/audio/audio.spec.ts) (133 tests globales pasando al 100%).
  * [x] Reporte de arquitectura técnica en [docs/PHASE_06_REAL_VOICE_AUDIO_PIPELINE.md](file:///c:/Users/Glado/CartoonFactory/docs/PHASE_06_REAL_VOICE_AUDIO_PIPELINE.md).
* **[x] PHASE 07 — VISUAL GENERATION & STORYBOARD PIPELINE (COMPLETADA)**
  * [x] Codificador binario puro PNG (RFC 2083 / ISO/IEC 15948) y `RasterCanvas` contiguo sin dependencias externas ([src/server/visuals/png.encoder.ts](file:///c:/Users/Glado/CartoonFactory/src/server/visuals/png.encoder.ts)).
  * [x] Motor de consistencia de personajes (`ConsistencyEngine`) con inyección de prompts maestros y semillas deterministas de 32 bits ([src/server/visuals/consistency.engine.ts](file:///c:/Users/Glado/CartoonFactory/src/server/visuals/consistency.engine.ts)).
  * [x] Proveedor determinista `SyntheticImageProvider` para escenas 16:9, model sheets 1:1 y miniaturas 1280x720 offline/dev/tests ([src/server/visuals/synthetic.provider.ts](file:///c:/Users/Glado/CartoonFactory/src/server/visuals/synthetic.provider.ts)).
  * [x] Proveedor `ImagenProvider` para Google Imagen 3 con fallback automático resiliente a generación sintética ([src/server/visuals/imagen.provider.ts](file:///c:/Users/Glado/CartoonFactory/src/server/visuals/imagen.provider.ts)).
  * [x] Orquestador `VisualService` con subida física a `StorageProvider` (rutas POSIX relativas), registro de assets e inmutabilidad en PostgreSQL con checksum SHA-256 ([src/server/visuals/visual.service.ts](file:///c:/Users/Glado/CartoonFactory/src/server/visuals/visual.service.ts)).
  * [x] Router Express `visualRouter` (`/scene`, `/batch`, `/character`, `/thumbnail`) con validación Zod y protección JWT montado en [src/server.ts](file:///c:/Users/Glado/CartoonFactory/src/server.ts).
  * [x] Integración en frontend Angular (`StoryboardView` & `Studio` service) con soporte de imagen ráster real 16:9, badges de formato y botón de lote ([src/app/components/storyboard-view.ts](file:///c:/Users/Glado/CartoonFactory/src/app/components/storyboard-view.ts)).
  * [x] Suite de 21 pruebas exhaustivas en [src/server/visuals/visual.spec.ts](file:///c:/Users/Glado/CartoonFactory/src/server/visuals/visual.spec.ts) (154 tests globales pasando al 100%).
  * [x] Reporte de arquitectura técnica en [docs/PHASE_07_VISUAL_GENERATION_STORYBOARD.md](file:///c:/Users/Glado/CartoonFactory/docs/PHASE_07_VISUAL_GENERATION_STORYBOARD.md).

* **[x] PHASE 08 — REAL VIDEO RENDERING ENGINE (FFMPEG WORKER) (COMPLETADA)**
  * [x] Envoltorio transparente para proceso hijo de FFmpeg (`runFfmpegCommand`, `renderSceneClip`, `concatSceneClips`, `mixAudioTracks`) sin dependencias externas pesadas ([src/server/render/ffmpeg.wrapper.ts](file:///c:/Users/Glado/CartoonFactory/src/server/render/ffmpeg.wrapper.ts)).
  * [x] Sintetizador determinista de música instrumental infantil en formato PCM WAV 44.1kHz estéreo ([src/server/render/music.synthesizer.ts](file:///c:/Users/Glado/CartoonFactory/src/server/render/music.synthesizer.ts)).
  * [x] Orquestador de renderizado asíncrono no bloqueante (`RenderService`) con arquitectura de jobs de 7 pasos atómicos, subida a `StorageProvider` (MP4, VTT, SRT) y persistencia en PostgreSQL (`Asset` VIDEO_RENDER, `AssetVersion` con SHA-256) ([src/server/render/render.service.ts](file:///c:/Users/Glado/CartoonFactory/src/server/render/render.service.ts)).
  * [x] Router Express `renderRouter` (`/start`, `/jobs/:jobId`, `/jobs/:jobId/events`, `/jobs/:jobId/cancel`, `/capabilities`) con retorno 202 Accepted, streaming SSE y protección JWT ([src/server/render/render.router.ts](file:///c:/Users/Glado/CartoonFactory/src/server/render/render.router.ts)).
  * [x] Integración en frontend Angular (`Studio` service & `AnimationEditorView`) eliminando los `setTimeout` simulados, agregando sondeo en tiempo real y reproductor nativo HTML5 MP4 con subtítulos WebVTT incrustados ([src/app/components/animation-editor-view.ts](file:///c:/Users/Glado/CartoonFactory/src/app/components/animation-editor-view.ts)).
  * [x] Suite de 16 pruebas automatizadas en [src/server/render/render.spec.ts](file:///c:/Users/Glado/CartoonFactory/src/server/render/render.spec.ts) (170 tests globales pasando al 100%).
  * [x] Reporte de arquitectura técnica en [docs/PHASE_08_REAL_VIDEO_RENDERING_ENGINE.md](file:///c:/Users/Glado/CartoonFactory/docs/PHASE_08_REAL_VIDEO_RENDERING_ENGINE.md).

* **[x] PHASE 09 — OBJECTIVE QUALITY CONTROL (AUDIO DRIFT & COPPA CHECKS) (COMPLETADA)**
  * [x] Verificador determinista de Audio Drift (`drift.verifier.ts`) con tolerancia reglamentaria $\le 0.05$s (50 ms), sonda FFprobe nativa y análisis de cadencia escena por escena ([src/server/qc/drift.verifier.ts](file:///c:/Users/Glado/CartoonFactory/src/server/qc/drift.verifier.ts)).
  * [x] Verificador determinista COPPA & FTC 16 CFR Part 312 (`coppa.verifier.ts`) con bloqueo de extracción de PII (emails, teléfonos, domicilios), anulación de llamadas comerciales agresivas y garantía de banderas obligatorias (`madeForKids: true`, visibilidad `PRIVATE`) ([src/server/qc/coppa.verifier.ts](file:///c:/Users/Glado/CartoonFactory/src/server/qc/coppa.verifier.ts)).
  * [x] Orquestador `QualityControlService` con bloqueo automático del proyecto (`isBlocked = true`, `approvedForProduction = false`) ante cualquier fallo crítico y persistencia relacional en PostgreSQL (`QCReport` y `QCCheck`) ([src/server/qc/qc.service.ts](file:///c:/Users/Glado/CartoonFactory/src/server/qc/qc.service.ts)).
  * [x] Router Express `qcRouter` (`/audit`, `/check-drift`, `/check-coppa`, `/reports/:episodeId`, `/approve/:episodeId`) con validación Zod estricta montado en [src/server.ts](file:///c:/Users/Glado/CartoonFactory/src/server.ts).
  * [x] Gatekeeper de publicación en [src/server.ts](file:///c:/Users/Glado/CartoonFactory/src/server.ts): `/api/youtube/publish` aborta con HTTP 422 si el episodio presenta drift desfasado o infracción COPPA activa.
  * [x] Integración en frontend Angular (`QcView` & `Studio` service) con telemetría de drift en milisegundos, banner de bloqueo crítico e inhabilitación reactiva de avance a emisión ([src/app/components/qc-view.ts](file:///c:/Users/Glado/CartoonFactory/src/app/components/qc-view.ts)).
  * [x] Suite de 26 pruebas automatizadas en [src/server/qc/qc.spec.ts](file:///c:/Users/Glado/CartoonFactory/src/server/qc/qc.spec.ts) (196 tests globales pasando al 100%).
  * [x] Reporte de arquitectura técnica en [docs/PHASE_09_OBJECTIVE_QUALITY_CONTROL.md](file:///c:/Users/Glado/CartoonFactory/docs/PHASE_09_OBJECTIVE_QUALITY_CONTROL.md).

* **[x] PHASE 10 — REAL YOUTUBE INTEGRATION (OAUTH 2.0 & DATA API V3) (COMPLETADA)**
  * [x] Módulo de cifrado simétrico autenticado AES-256-GCM (`encryption.ts`) para credenciales en reposo con derivación de claves SHA-256, vectores de inicialización NIST de 96 bits independientes por token y verificación de integridad estricta ([src/server/youtube/encryption.ts](file:///c:/Users/Glado/CartoonFactory/src/server/youtube/encryption.ts)).
  * [x] Servicio Google OAuth 2.0 (`oauth.service.ts`) con generación de URLs de consentimiento con scopes oficiales (`youtube.upload`, `youtube.readonly`, `userinfo.email`, `userinfo.profile`), protección CSRF mediante parámetro `state` firmado con HMAC-SHA256 y rotación/refresco automático de access tokens ([src/server/youtube/oauth.service.ts](file:///c:/Users/Glado/CartoonFactory/src/server/youtube/oauth.service.ts)).
  * [x] Servicio de gestión y sincronización de canales de YouTube (`channel.service.ts`) con persistencia relacional en PostgreSQL (`YouTubeChannel` y conexión M:N `YouTubeChannelConnection`) y desconexión segura ([src/server/youtube/channel.service.ts](file:///c:/Users/Glado/CartoonFactory/src/server/youtube/channel.service.ts)).
  * [x] Uploader reanudable de YouTube Data API v3 (`uploader.service.ts`) con protocolo en 2 fases (`uploadType=resumable`), inyección obligatoria de metadatos COPPA (`selfDeclaredMadeForKids: true`), visibilidad `PRIVATE` por defecto, subida opcional de miniaturas 1280x720 PNG y registro en `YouTubePublication` y telemetría de cuotas en `ProviderExecution` ([src/server/youtube/uploader.service.ts](file:///c:/Users/Glado/CartoonFactory/src/server/youtube/uploader.service.ts)).
  * [x] Orquestador maestro `YouTubeService` con integración del Gatekeeper de Calidad (QC) de Phase 09 (bloqueo HTTP 422 ante desincronización o infracción COPPA) y modo Sandbox resiliente sin dependencias externas pesadas ([src/server/youtube/youtube.service.ts](file:///c:/Users/Glado/CartoonFactory/src/server/youtube/youtube.service.ts)).
  * [x] Router Express `youtubeRouter` (`/auth-url`, `/callback`, `/status`, `/publish`, `/disconnect`, `/publications/:episodeId`) montado en [src/server.ts](file:///c:/Users/Glado/CartoonFactory/src/server.ts).
  * [x] Integración en frontend Angular (`YouTubeView` y servicio `Studio`) con tarjetas de canal reactivas, botones de vincular/desvincular OAuth 2.0 y soporte de publicación ([src/app/components/youtube-view.ts](file:///c:/Users/Glado/CartoonFactory/src/app/components/youtube-view.ts)).
  * [x] Suite de 29 pruebas automatizadas en [src/server/youtube/youtube.spec.ts](file:///c:/Users/Glado/CartoonFactory/src/server/youtube/youtube.spec.ts) (225 tests globales pasando al 100%).
* [x] PHASE 11 — BACKGROUND SCHEDULER & WORKER QUEUES (COMPLETADA)
  * [x] Motor de jobs desacoplado en `cartoon-worker` respaldado por PostgreSQL (`production_jobs` y `job_steps`) y fallback en memoria resiliente ([src/server/scheduler/worker.queue.ts](file:///c:/Users/Glado/CartoonFactory/src/server/scheduler/worker.queue.ts)).
  * [x] Catálogo canónico de handlers asíncronos para todas las etapas pesadas: `SCRIPTING`, `VOICE_GENERATION`, `ASSET_GENERATION`, `STORYBOARDING`, `FFMPEG_RENDER`, `VALIDATION` y `YOUTUBE_PUBLISH` ([src/server/scheduler/job.handlers.ts](file:///c:/Users/Glado/CartoonFactory/src/server/scheduler/job.handlers.ts)).
  * [x] Control estricto de concurrencia (`maxConcurrency`), bloqueo atómico de tareas (*claim*), pasos atómicos inmutables con `uq_job_step_index`, reintentos automáticos y cancelación por `AbortController`.
  * [x] Planificador editorial desatendido (`EditorialScheduler`) que monitoriza `editorial_calendar_items`, verifica el Gatekeeper de Calidad (QC) de Phase 09, y dispara automáticamente publicaciones a YouTube conforme a normativas COPPA al llegar su hora programada ([src/server/scheduler/editorial.scheduler.ts](file:///c:/Users/Glado/CartoonFactory/src/server/scheduler/editorial.scheduler.ts)).
  * [x] Transición automática del calendario a `BROADCASTED`, vinculación de `youtubePublicationId` y persistencia en PostgreSQL.
  * [x] Coordinador maestro singleton `SchedulerService` y router Express `schedulerRouter` con semántica HTTP 202 Accepted, SSE streaming (`/jobs/:id/events`), y endpoints CRUD para calendario y gestión de colas ([src/server/scheduler/scheduler.router.ts](file:///c:/Users/Glado/CartoonFactory/src/server/scheduler/scheduler.router.ts)).
  * [x] Integración en interfaz de usuario Angular (`CalendarView` y servicio `Studio`) con indicador reactivo del demonio y botón de comprobación manual forzada ([src/app/components/calendar-view.ts](file:///c:/Users/Glado/CartoonFactory/src/app/components/calendar-view.ts)).
  * [x] Suite de 27 pruebas automatizadas en [src/server/scheduler/scheduler.spec.ts](file:///c:/Users/Glado/CartoonFactory/src/server/scheduler/scheduler.spec.ts) (252 tests globales pasando al 100% y `ng build` exitoso).
  * [x] Reporte de arquitectura técnica en [docs/PHASE_11_BACKGROUND_SCHEDULER_WORKER_QUEUES.md](file:///c:/Users/Glado/CartoonFactory/docs/PHASE_11_BACKGROUND_SCHEDULER_WORKER_QUEUES.md).

---

## 12. REGLA DE CONTINUIDAD
1. **Rama `main` intacta** en el baseline original de Google AI Studio (`1eae2f8`).
2. **Desarrollo activo en `Try1`** con cimientos de arquitectura Server-First.
3. Se esperará confirmación del usuario tras la entrega de Phase 11 antes de proceder con **PHASE 12** (`End-to-End Automation Loop`).





