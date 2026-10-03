# PHASE 01 — DOMAIN & ARCHITECTURE DISCOVERY
## Especificación Canónica del Dominio, Modelo Relacional y Arquitectura Backend

> **Documento:** Documento Técnico de Arquitectura de Dominio (Phase 01 Discovery)  
> **Rama:** `Try1` (Baseline: Google AI Studio `main` @ `1eae2f8`)  
> **Perfil:** Principal Research Software Engineer & AI Systems Architect  
> **Fecha:** 3 de Octubre de 2026  
> **Estado:** Aprobado para Revisión Técnica Previa a Prisma/PostgreSQL  

---

## 1. RESUMEN EJECUTIVO & PROPÓSITO

El prototipo original de Google AI Studio implementó una SPA reactiva en Angular donde el estado de la aplicación vivía íntegramente en memoria del cliente a través de Angular Signals (`Studio`), apoyado por mocks estáticos y llamadas ad-hoc a endpoints mínimos de Express.

El objetivo de este documento es formalizar el **modelo de dominio canónico** de **Cartoon Studio**, eliminando las abstracciones redundantes, separando el estado de presentación del estado de persistencia, definiendo los límites de agregados (*Aggregate Boundaries*), estableciendo máquinas de estado desacopladas y sentando las bases del esquema PostgreSQL / Prisma que se implementará en la Fase 02.

---

## 2. AUDITORÍA FORENSE DEL MODELO ACTUAL

Tras auditar [src/app/models/studio.models.ts](file:///c:/Users/Glado/CartoonFactory/src/app/models/studio.models.ts), [src/app/services/studio.ts](file:///c:/Users/Glado/CartoonFactory/src/app/services/studio.ts) y los componentes visuales asociados, se identificaron los siguientes patrones estructurales:

### 2.1. Colapso de Identidad: `Project` vs `Episode`
* En el modelo actual, la interfaz `Project` representa simultáneamente:
  1. La metadata narrativa de un episodio único (`title`, `idea`, `logline`, `moral`, `ending`, `educationalObjective`).
  2. La estructura audiovisual del episodio (`scenes`, `characters`).
  3. Los archivos de salida y subtítulos (`videoTrack.subtitlesSrt`, `videoTrack.videoUrl`).
  4. La configuración de publicación en YouTube (`youtubeMetadata`).
  5. Las métricas de consumo (`costMetrics`).
* Simultáneamente, en `EditorialCalendarItem`, se referencia a `projectId` pero se introduce el campo `episodeCode: 'EP01'`.
* En `SeriesView`, el botón de acción dice explícitamente: *"Nuevo Episodio de Serie"*, invocando `createNewProject()`.
* **Diagnóstico:** El concepto de `Project` en el código de Google AI Studio es un sinónimo directo de **`Episode`**. No existe una jerarquía donde un "Proyecto" agrupe varios episodios; cada proyecto es exactamente un episodio de animación de 1 a 5 minutos.

### 2.2. Identificadores Generados en el Cliente
* Todos los identificadores son strings sintetizados en el frontend mediante timestamps y números aleatorios:
  * Proyectos: `'proj_' + Date.now().toString(36)`
  * Jobs: `'job_' + Date.now().toString(36)`
  * Personajes: `` `char_${projectId}_${idx}` ``
  * Escenas: `` `sc_${projectId}_${idx}` ``
  * Calendario: `'cal_' + Date.now().toString(36)`
* **Riesgo:** Cero unicidad garantizada en entornos distribuidos, imposibilidad de indexación B-Tree óptima y colisiones potenciales ante concurrencia.

### 2.3. Acoplamiento de UI y Dominio
* **Vectores SVG incrustados en memoria:** La interfaz `Scene` contiene `visualSvg?: string` y `Character` contiene `avatarSvg?: string`. Strings de varios kilobytes de XML SVG se almacenan directamente dentro de las entidades de dominio, bloqueando el garbage collector y saturando el estado reactivo.
* **Subtítulos recalculados y duplicados:** `Studio.generateSubtitlesSrt()` y `generateSubtitlesVtt()` generan cadenas de subtítulos iterando sobre las escenas, almacenándolas dos veces como texto plano dentro de `videoTrack.subtitlesSrt` y `videoTrack.subtitlesVtt`.
* **Relaciones no normalizadas por clave foránea:** En `Scene.characters`, la escena almacena un array de strings con los nombres (`['Milo', 'Tula']`) en lugar de claves foráneas a las entidades `Character`. Si un personaje cambia de nombre, la integridad referencial se rompe inmediatamente.

### 2.4. Datos Huérfanos y Mocks No Persistidos
* `LibraryItem`: Elementos de biblioteca (`character`, `background`, `music`, `sfx`) viven en un Signal hardcodeado en memoria sin vinculación a series ni a episodios.
* `ProductionJob`: Los trabajos de producción son registrados en un array en memoria; un refresco de pantalla (`F5`) destruye todo el historial de ejecución técnica.
* `YouTubeChannelInfo`: Estado de canal totalmente desacoplado de tokens de autorización o base de datos.

---

## 3. DEFINICIÓN DEL DOMINIO CANÓNICO

### 3.1. Resolución Semántica: ¿`Series` → `Project` → `Episode` o `Series` → `Episode`?

Analizadas las tres opciones:

* **Opción A (`Series → Project → Episode`):** Redundancia innecesaria. Un "Project" que contiene un solo "Episode" añade una tabla intermedia y capas de indirección sin justificación de negocio.
* **Opción B (`Series → Episode` — ADOPTADA COMO CANÓNICA):**
  * **`Series` (Universo Narrativo / Franquicia):** Entidad permanente que define la biblia de la franquicia (personajes recurrentes, reglas de mundo, estilo visual maestro 3D, edad diana, idioma, canal de YouTube predeterminado).
  * **`Episode` (Unidad de Producción Audiovisual):** Entidad central de trabajo. Cada episodio pertenece obligatoriamente a una `Series` (o a una serie especial "Pilotos Independientes"). Contiene su guion, escenas, personajes asignados, assets generados, timeline y publicación.
* **¿Qué ocurre con la palabra `Project` en el frontend actual?**
  * Para mantener compatibilidad con la interfaz de usuario existente sin romper vistas, en el frontend se mantendrá la etiqueta visual *"Proyectos"* como sinónimo de *"Episodios en Producción"*, pero en el dominio, en la API y en la base de datos la entidad canónica se denomina formalmente **`Episode`**.

---

## 4. MAPA DE ENTIDADES CANÓNICAS

| Entity | Purpose | Owner / Parent | Relations | Persistent? | Current Location |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **`User`** | Representa al creador/administrador del estudio. | Root | 1 ── N `Series`, 1 ── N `YouTubeChannel` | Sí | Inexistente (implicado) |
| **`Series`** | Franquicia audiovisual y biblia narrativa recurrente. | `User` | 1 ── N `Episode`, 1 ── N `Character` (Maestros) | Sí | `studio.ts:32`, `models:150` |
| **`Episode`** | Unidad narrativa y de renderizado (anteriormente `Project`). | `Series` | 1 ── N `Scene`, 1 ── N `Job`, 1 ── 1 `QCReport`, 1 ── 1 `Publication` | Sí | `studio.ts:30`, `models:124` |
| **`Character`** | Ficha técnica de personaje con prompts de consistencia visual. | `Series` o `Episode` | 1 ── 1 `VoiceProfile`, N ── M `Scene` | Sí | `models:23` |
| **`CharacterVoiceProfile`** | Configuración de síntesis vocal (pitch, rate, timbre, voiceId). | `Character` | 1 ── 1 `Character` | Sí | `models:15` |
| **`Scene`** | Bloque temporal audiovisual unitario (visual + audio + texto). | `Episode` | 1 ── N `Asset` (imagen, voz, sfx), N ── M `Character` | Sí | `models:43` |
| **`Asset`** | Archivo físico multimedia gestionado por `StorageProvider`. | `Episode` / `Scene` | 1 ── 1 Referencia física URI en storage | Sí | `models:190` (parcial en `LibraryItem`) |
| **`ProductionJob`** | Registro de ejecución de tarea asíncrona pesada (Render, TTS, AI). | `Episode` | 1 ── N `JobAttempt` | Sí | `studio.ts:34`, `models:163` |
| **`JobAttempt`** | Reintento específico de un job ante fallos transitorios. | `ProductionJob` | N ── 1 `ProductionJob` | Sí | Inexistente (nuevo) |
| **`QCReport`** | Informe de auditoría pedagógica, coherencia y COPPA. | `Episode` | 1 ── 1 `Episode` | Sí | `models:68` |
| **`YouTubeChannel`** | Canal de YouTube autenticado vía OAuth 2.0. | `User` | 1 ── N `YouTubePublication`, 1 ── 1 `OAuthCredential` | Sí | `studio.ts:45`, `models:177` |
| **`YouTubeOAuthCredential`**| Tokens de acceso y refresco cifrados con AES-256-GCM. | `YouTubeChannel`| 1 ── 1 `YouTubeChannel` | Sí | Inexistente (hardcoded demo) |
| **`YouTubePublication`** | Estado de subida, visibilidad y metadatos SEO de un episodio. | `Episode` | N ── 1 `YouTubeChannel`, 1 ── 1 `Episode` | Sí | `models:84` (embebido) |
| **`EditorialCalendarItem`** | Proyección temporal de emisión en calendario editorial. | `Episode` | 1 ── 1 `Episode` | Derivado / Sí | `studio.ts:36`, `models:203` |
| **`CostMetric`** | Registro transaccional de consumo de tokens, audio e imágenes. | `Episode` / `Job` | N ── 1 `Episode`, N ── 1 `ProductionJob` | Sí | `models:102` (agregado plano) |

---

## 5. LÍMITES DE AGREGADOS (AGGREGATE BOUNDARIES)

Para evitar grafos de objetos masivos y bloqueos transaccionales en PostgreSQL, se delimitan cuatro agregados principales:

```
┌────────────────────────────────────────────────────────┐
│ SERIES AGGREGATE                                       │
│ [Series Root]                                          │
│   ├── Narrative Rules & Style Bible                    │
│   └── Master Character Templates (reutilizables)       │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ EPISODE AGGREGATE (Root de Producción Audiovisual)     │
│ [Episode Root]                                         │
│   ├── Narrative Script (Logline, Moral, Ending)        │
│   ├── Episode Characters (instancias de la serie)      │
│   ├── Scenes (secuencia ordenada 1..N)                 │
│   │     ├── Direction & Camera Cues                    │
│   │     └── Dialogue & Narration Lines                 │
│   └── QC Report (evaluación aprobada/rechazada)        │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ PRODUCTION JOB AGGREGATE (Asíncrono / Resiliencia)    │
│ [ProductionJob Root]                                   │
│   ├── Job Type (STORY_GEN, TTS, RENDER, QC, UPLOAD)    │
│   ├── Progress & Execution State                       │
│   ├── Job Attempts & Error Traces                      │
│   └── Cost Metrics (tokens, cómputo consumido)         │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ PUBLICATION & DISTRIBUTION AGGREGATE                   │
│ [YouTubePublication Root]                              │
│   ├── Channel Reference                                │
│   ├── YouTube Metadata (COPPA, SEO, Tags, Playlists)   │
│   ├── Scheduling Time & Status                         │
│   └── Published Video Output (VideoId, URL)            │
└────────────────────────────────────────────────────────┘
```

---

## 6. DIAGRAMA TEXTUAL DEL DOMINIO (ENTITY RELATIONSHIP)

```
 [User]
   │ 1
   ├──────────────────────────────┐
   │ N                            │ N
   ▼                              ▼
[Series]                   [YouTubeChannel]
   │ 1                            │ 1
   │                              ▼
   │                      [OAuthCredential]
   │                       (AES-256 Encrypted)
   │ 1                            │
   ▼ N                            │ 1
[Episode] ◄───────────────────────┤
   │                              │ N
   ├──────────────┬───────────────┴───────────────┐
   │ 1            │ 1                             │ 1
   ▼ N            ▼ 1                             ▼ 1
[Scene]       [QCReport]               [YouTubePublication]
   │ 1                                            ▲
   │                                              │
   ├──────────────────────────────┐               │
   │ N                            │ N             │
   ▼                              ▼               │
[Asset]                   [ProductionJob] ────────┘
 (Image/Audio/Video/SRT)         │ 1
                                 │
                                 ▼ N
                            [JobAttempt]
```

---

## 7. MÁQUINAS DE ESTADOS DESACOPLADAS

El prototipo actual colapsa el estado del pipeline en un único string `ProjectPipelineStatus`. En la arquitectura canónica se segregan cuatro máquinas de estado deterministas:

### 7.1. `EpisodeLifecycleStatus` (Estado Editorial del Episodio)
```
[DRAFT] ──► [SCRIPTING] ──► [STORYBOARDING] ──► [VOICE_SYNC] 
   ▲                                                 │
   │ (rechazo en QC)                                 ▼
   └─────────────── [QC_REVIEW] ◄────────────── [RENDERING]
                           │ (aprobado)
                           ▼
                      [APPROVED] ──► [ARCHIVED]
```

### 7.2. `ProductionJobStatus` (Estado Técnico de Cola Asíncrona)
```
[PENDING] ──► [QUEUED] ──► [PROCESSING] ──► [COMPLETED]
                              │
                              ├──► [FAILED] (Reintentos agotados)
                              │
                              └──► [CANCELLED]
```

### 7.3. `PublicationStatus` (Estado de Distribución en YouTube)
```
[NOT_CONFIGURED] ──► [METADATA_READY] ──► [SCHEDULED] 
                                                │
                                                ▼
[PUBLISHED_PUBLIC] ◄── [PUBLISHED_PRIVATE] ◄── [UPLOADING]
       ▲                      │                     │ (error API)
       │ (revisión humana)    ▼ (publicación)       ▼
       └──────────────────────┴─────────────── [UPLOAD_FAILED]
```

### 7.4. `SceneAssetStatus` (Estado de Generación por Escena)
* `visualState`: `PENDING` | `GENERATING` | `READY` | `FAILED`
* `voiceState`: `PENDING` | `GENERATING` | `SYNTHESIZED` | `FAILED`

---

## 8. MATRIZ DE RESPONSABILIDADES DE SISTEMA

| Responsabilidad | Ubicación Actual | Destino Arquitectónico Canónico | Componente Encargado |
| :--- | :--- | :--- | :--- |
| **Generación de Historia (Guion)** | Express `/api/generate-story` | Backend API / Service | `AIProvider` (Gemini 3.8 Flash) |
| **Generación de Biblia de Personaje** | Express `/api/generate-character` | Backend API / Service | `AIProvider` (Gemini 3.8 Flash) |
| **Generación Visual de Escenas** | SVG estático en Frontend (`VisualGenerator`) | Worker Asíncrono (`cartoon-worker`) | `ImageProvider` (Imagen 3 / SVG Generator) |
| **Síntesis Vocal (TTS)** | `window.speechSynthesis` (Browser) | Worker Asíncrono (`cartoon-worker`) | `TTSProvider` (Google Cloud TTS / ElevenLabs) |
| **Cálculo de Subtítulos (SRT / VTT)** | Métodos en `studio.ts:521` | Backend Service / Worker | `SubtitleService` (Derivado determinista) |
| **Ensamblado y Render de Vídeo** | Mocks `setTimeout()` en `studio.ts:908` | Worker Asíncrono (`cartoon-worker`) | `FFmpegPipeline` (H.264 / AAC / MP4) |
| **Auditoría de Calidad (QC)** | Express `/api/quality-control` | Backend Service / Worker | `AIProvider` (Auditor de COPPA y Coherencia) |
| **Generación de Miniaturas** | SVG en Canvas cliente | Worker Asíncrono (`cartoon-worker`) | `ImageProvider` + Sharp (1280x720 PNG) |
| **Contabilidad de Costes y Tokens** | Estado reactivo plano en `studio.ts` | Backend Interceptor / Base de Datos | Tabla `CostMetric` (por llamada/job) |
| **Orquestación y Reintentos de Jobs** | Array en memoria de Signals | Backend Queue + Base de Datos | PostgreSQL Job Queue / Worker Runner |
| **Publicación en YouTube** | Mock `/api/youtube/publish` | Worker Asíncrono (`cartoon-worker`) | `YouTubeProvider` (Resumable Upload) |
| **Gestión de Calendario Editorial** | Array en memoria de Signals | Vista derivada en Backend | Consulta indexada sobre `episodes` y `publications` |
| **Generación de Identificadores** | Strings aleatorios en cliente | Backend / PostgreSQL | UUID v4 / CUID |

---

## 9. DISEÑO DE LA API REST CANÓNICA

Todos los endpoints se ubican bajo el prefijo `/api/v1/`:

### 9.1. Series & Biblia
* `GET    /api/v1/series` — Lista todas las series del usuario.
* `POST   /api/v1/series` — Crea una nueva serie con sus reglas narrativas.
* `GET    /api/v1/series/:id` — Obtiene la biblia completa de la serie y personajes recurrentes.
* `PATCH  /api/v1/series/:id` — Actualiza reglas narrativas o estilo visual maestro.
* `DELETE /api/v1/series/:id` — Borrado lógico de la serie.

### 9.2. Episodios (Producciones)
* `GET    /api/v1/episodes` — Lista episodios con filtros (`seriesId`, `status`).
* `POST   /api/v1/episodes` — Inicializa un nuevo episodio en estado `DRAFT`.
* `GET    /api/v1/episodes/:id` — Obtiene el estado íntegro del episodio (escenas, personajes, QC).
* `PATCH  /api/v1/episodes/:id` — Actualiza campos directos del episodio (título, idea, moral).
* `DELETE /api/v1/episodes/:id` — Elimina o archiva un episodio.

### 9.3. Pipelines & Operaciones de Generación (Retorno 202 Accepted)
* `POST   /api/v1/episodes/:id/generate-story` — Despacha job de generación de guion con Gemini.
* `POST   /api/v1/episodes/:id/generate-characters` — Despacha job de consistencia de personajes.
* `POST   /api/v1/episodes/:id/generate-visuals` — Despacha generación de imágenes de escenas.
* `POST   /api/v1/episodes/:id/synthesize-voice` — Despacha síntesis TTS de diálogos y narración.
* `POST   /api/v1/episodes/:id/render` — Despacha trabajo de ensamblado FFmpeg. Retorna `202 Accepted { jobId }`.
* `POST   /api/v1/episodes/:id/qc-audit` — Despacha auditoría de calidad y COPPA.
* `POST   /api/v1/episodes/:id/generate-thumbnail` — Despacha generación de miniatura 1280x720.

### 9.4. Trabajos Asíncronos (Jobs)
* `GET    /api/v1/jobs/:id` — Consulta estado, progreso porcentual y step actual de un job.
* `POST   /api/v1/jobs/:id/cancel` — Solicita cancelación de un job en ejecución.

### 9.5. YouTube & Publicación
* `GET    /api/v1/youtube/channels` — Lista canales vinculados y su estado de cuota/OAuth.
* `POST   /api/v1/youtube/oauth/start` — Inicia flujo OAuth 2.0 con Google.
* `GET    /api/v1/youtube/oauth/callback` — Endpoint de intercambio de código por tokens.
* `POST   /api/v1/episodes/:id/publish` — Encola la publicación a YouTube (Privado por defecto).

### 9.6. Calendario & Métricas
* `GET    /api/v1/calendar` — Proyección editorial mensual consolidada.
* `GET    /api/v1/analytics/overview` — Métricas de audiencia y retención (YouTube Analytics API).
* `GET    /api/v1/costs/summary` — Auditoría de gasto acumulado en euros (€) vs presupuesto autorizado.

---

## 10. PROPUESTA DE ROUTING CANÓNICO EN ANGULAR

Actualmente `app.html` utiliza `@switch (studio.activeSection())` sin rutas profundas en el navegador. La estructura canónica que se implementará en la refactorización de rutas es:

```typescript
export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: DashboardView },
  
  // Series
  { path: 'series', component: SeriesView },
  
  // Episodios / Producciones
  { path: 'episodes', component: ProjectsListView },
  { path: 'episodes/:id', redirectTo: 'episodes/:id/story', pathMatch: 'full' },
  { path: 'episodes/:id/story', component: StoryView },
  { path: 'episodes/:id/characters', component: CharactersView },
  { path: 'episodes/:id/storyboard', component: StoryboardView },
  { path: 'episodes/:id/voice', component: VoiceView },
  { path: 'episodes/:id/animation', component: AnimationEditorView },
  { path: 'episodes/:id/qc', component: QcView },
  { path: 'episodes/:id/thumbnail', component: ThumbnailView },
  { path: 'episodes/:id/publish', component: YouTubeView },
  
  // Vistas transversales
  { path: 'library', component: LibraryView },
  { path: 'calendar', component: CalendarView },
  { path: 'analytics', component: AnalyticsView },
  { path: 'settings', component: SettingsView },
  
  { path: '**', redirectTo: 'dashboard' }
];
```

---

## 11. PROPUESTA DE ESQUEMA RELACIONAL (POSTGRESQL & PRISMA)

El esquema relacional propuesto para implementar en Phase 02:

### 11.1. Enums del Sistema
```sql
CREATE TYPE "EpisodeStatus" AS ENUM (
  'DRAFT', 'SCRIPTING', 'STORYBOARDING', 'VOICE_SYNC', 
  'RENDERING', 'QC_REVIEW', 'APPROVED', 'ARCHIVED'
);

CREATE TYPE "JobType" AS ENUM (
  'STORY_GEN', 'CHARACTERS_GEN', 'SCENE_VISUAL_GEN', 
  'TTS_SYNTHESIS', 'VIDEO_RENDER', 'QC_AUDIT', 
  'THUMBNAIL_GEN', 'YOUTUBE_UPLOAD'
);

CREATE TYPE "JobStatus" AS ENUM (
  'PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'
);

CREATE TYPE "PrivacyStatus" AS ENUM (
  'PRIVATE', 'UNLISTED', 'PUBLIC', 'SCHEDULED'
);

CREATE TYPE "AssetType" AS ENUM (
  'IMAGE_SCENE', 'IMAGE_CHARACTER', 'AUDIO_VOICE', 
  'AUDIO_MUSIC', 'AUDIO_SFX', 'VIDEO_RENDER', 
  'SUBTITLE_SRT', 'SUBTITLE_VTT', 'THUMBNAIL'
);
```

### 11.2. Definición de Tablas Principales

#### `users`
* `id`: UUID (PK, `gen_random_uuid()`)
* `email`: VARCHAR(255) (UNIQUE, NOT NULL)
* `name`: VARCHAR(255) (NOT NULL)
* `created_at`: TIMESTAMPTZ (DEFAULT NOW())
* `updated_at`: TIMESTAMPTZ (DEFAULT NOW())

#### `series`
* `id`: UUID (PK)
* `user_id`: UUID (FK `users.id`, ON DELETE CASCADE)
* `name`: VARCHAR(255) (NOT NULL)
* `description`: TEXT
* `main_character_name`: VARCHAR(100) (NOT NULL)
* `visual_style`: VARCHAR(255) (NOT NULL)
* `target_age`: VARCHAR(50) (NOT NULL)
* `language`: VARCHAR(50) (DEFAULT 'Spanish')
* `episode_length_default`: VARCHAR(50)
* `rules`: JSONB (DEFAULT '[]'::jsonb)
* `created_at`: TIMESTAMPTZ (DEFAULT NOW())
* `updated_at`: TIMESTAMPTZ (DEFAULT NOW())

#### `episodes`
* `id`: UUID (PK)
* `series_id`: UUID (FK `series.id`, ON DELETE RESTRICT)
* `title`: VARCHAR(255) (NOT NULL)
* `idea`: TEXT (NOT NULL)
* `target_age`: VARCHAR(50) (NOT NULL)
* `language`: VARCHAR(50) (DEFAULT 'Spanish')
* `duration_category`: VARCHAR(50)
* `educational_objective`: TEXT
* `tone`: VARCHAR(100)
* `status`: "EpisodeStatus" (DEFAULT 'DRAFT')
* `logline`: TEXT
* `moral`: TEXT
* `ending`: TEXT
* `thumbnail_url`: TEXT
* `video_url`: TEXT
* `created_at`: TIMESTAMPTZ (DEFAULT NOW())
* `updated_at`: TIMESTAMPTZ (DEFAULT NOW())
* *Índices:* `CREATE INDEX idx_episodes_series_status ON episodes(series_id, status);`

#### `characters`
* `id`: UUID (PK)
* `series_id`: UUID (FK `series.id`, ON DELETE SET NULL, NULL para exclusivos de episodio)
* `episode_id`: UUID (FK `episodes.id`, ON DELETE CASCADE, NULL para personajes maestros de serie)
* `name`: VARCHAR(100) (NOT NULL)
* `species`: VARCHAR(100) (NOT NULL)
* `personality`: TEXT
* `age`: VARCHAR(50)
* `color_palette`: JSONB (Array de HEX strings)
* `clothing`: TEXT
* `visual_features`: TEXT
* `visual_consistency_prompt`: TEXT (NOT NULL)
* `master_prompt`: TEXT (NOT NULL)
* `tagline`: VARCHAR(255)
* `turnaround_notes`: TEXT
* `avatar_asset_id`: UUID (Nullable)
* `created_at`: TIMESTAMPTZ (DEFAULT NOW())
* `updated_at`: TIMESTAMPTZ (DEFAULT NOW())

#### `character_voice_profiles`
* `id`: UUID (PK)
* `character_id`: UUID (FK `characters.id`, ON DELETE CASCADE, UNIQUE)
* `provider`: VARCHAR(50) (NOT NULL, ej: 'google-cloud-tts', 'elevenlabs')
* `voice_id`: VARCHAR(100) (NOT NULL)
* `pitch`: NUMERIC(4, 2) (DEFAULT 1.0)
* `speed`: NUMERIC(4, 2) (DEFAULT 1.0)
* `timbre`: VARCHAR(100)
* `language`: VARCHAR(50) (DEFAULT 'es-ES')
* `created_at`: TIMESTAMPTZ (DEFAULT NOW())

#### `scenes`
* `id`: UUID (PK)
* `episode_id`: UUID (FK `episodes.id`, ON DELETE CASCADE)
* `scene_index`: INT (NOT NULL) -- Orden secuencial 0..N
* `scene_code`: VARCHAR(50) (NOT NULL) -- 'SCENE_01'
* `location`: VARCHAR(255) (NOT NULL)
* `time_of_day`: VARCHAR(50) (NOT NULL)
* `action_description`: TEXT (NOT NULL)
* `camera_direction`: TEXT
* `dialogue_text`: TEXT
* `narration_text`: TEXT
* `sound_effects`: TEXT
* `music_cue`: TEXT
* `duration_seconds`: INT (NOT NULL DEFAULT 15)
* `visual_prompt`: TEXT (NOT NULL)
* `motion_type`: VARCHAR(50) (DEFAULT 'pan-left')
* `visual_asset_id`: UUID (FK `assets.id`, ON DELETE SET NULL)
* `voice_asset_id`: UUID (FK `assets.id`, ON DELETE SET NULL)
* `created_at`: TIMESTAMPTZ (DEFAULT NOW())
* `updated_at`: TIMESTAMPTZ (DEFAULT NOW())
* *Unique Constraint:* `UNIQUE(episode_id, scene_index)`

#### `assets`
* `id`: UUID (PK)
* `episode_id`: UUID (FK `episodes.id`, ON DELETE CASCADE, Nullable para assets compartidos)
* `type`: "AssetType" (NOT NULL)
* `storage_driver`: VARCHAR(50) (NOT NULL, 'local' o 's3')
* `storage_key`: VARCHAR(1024) (NOT NULL) -- Ruta relativa POSIX o S3 Key
* `mime_type`: VARCHAR(100) (NOT NULL)
* `size_bytes`: BIGINT (NOT NULL)
* `checksum_sha256`: VARCHAR(64)
* `metadata`: JSONB (Dimensiones, duración en segundos, etc.)
* `created_at`: TIMESTAMPTZ (DEFAULT NOW())

#### `production_jobs`
* `id`: UUID (PK)
* `episode_id`: UUID (FK `episodes.id`, ON DELETE CASCADE)
* `type`: "JobType" (NOT NULL)
* `status`: "JobStatus" (DEFAULT 'PENDING')
* `progress`: INT (DEFAULT 0)
* `step_description`: TEXT
* `error_message`: TEXT
* `error_details`: JSONB
* `started_at`: TIMESTAMPTZ
* `completed_at`: TIMESTAMPTZ
* `created_at`: TIMESTAMPTZ (DEFAULT NOW())
* `updated_at`: TIMESTAMPTZ (DEFAULT NOW())
* *Índices:* `CREATE INDEX idx_jobs_status_created ON production_jobs(status, created_at);`

#### `qc_reports`
* `id`: UUID (PK)
* `episode_id`: UUID (FK `episodes.id`, ON DELETE CASCADE, UNIQUE)
* `overall_score`: INT (NOT NULL)
* `approved_for_production`: BOOLEAN (NOT NULL DEFAULT FALSE)
* `story_coherence`: JSONB (NOT NULL) -- { score, status, notes }
* `character_continuity`: JSONB (NOT NULL)
* `audio_dialogue`: JSONB (NOT NULL)
* `visual_feasibility`: JSONB (NOT NULL)
* `safety_coppa`: JSONB (NOT NULL)
* `youtube_engagement`: JSONB (NOT NULL)
* `flags`: JSONB (DEFAULT '[]'::jsonb)
* `recommendations`: JSONB (DEFAULT '[]'::jsonb)
* `audited_at`: TIMESTAMPTZ (DEFAULT NOW())
* `auditor_model`: VARCHAR(100) (DEFAULT 'gemini-3.8-flash')

#### `youtube_channels`
* `id`: UUID (PK)
* `user_id`: UUID (FK `users.id`, ON DELETE CASCADE)
* `channel_id`: VARCHAR(100) (UNIQUE, NOT NULL)
* `channel_title`: VARCHAR(255) (NOT NULL)
* `channel_custom_url`: VARCHAR(100)
* `subscriber_count`: VARCHAR(50)
* `video_count`: INT (DEFAULT 0)
* `view_count`: VARCHAR(50)
* `avatar_url`: TEXT
* `is_demo_mode`: BOOLEAN (DEFAULT TRUE)
* `status_message`: TEXT
* `created_at`: TIMESTAMPTZ (DEFAULT NOW())
* `updated_at`: TIMESTAMPTZ (DEFAULT NOW())

#### `youtube_oauth_credentials`
* `id`: UUID (PK)
* `channel_id`: UUID (FK `youtube_channels.id`, ON DELETE CASCADE, UNIQUE)
* `encrypted_access_token`: TEXT (NOT NULL)
* `encrypted_refresh_token`: TEXT (NOT NULL)
* `iv`: VARCHAR(64) (NOT NULL) -- Vector de inicialización AES
* `auth_tag`: VARCHAR(64) (NOT NULL) -- GCM Auth Tag
* `token_expiry`: TIMESTAMPTZ (NOT NULL)
* `scopes`: JSONB (NOT NULL)
* `created_at`: TIMESTAMPTZ (DEFAULT NOW())
* `updated_at`: TIMESTAMPTZ (DEFAULT NOW())

#### `youtube_publications`
* `id`: UUID (PK)
* `episode_id`: UUID (FK `episodes.id`, ON DELETE CASCADE, UNIQUE)
* `channel_id`: UUID (FK `youtube_channels.id`, ON DELETE RESTRICT)
* `title`: VARCHAR(100) (NOT NULL)
* `description`: TEXT (NOT NULL)
* `tags`: JSONB (DEFAULT '[]'::jsonb)
* `hashtags`: JSONB (DEFAULT '[]'::jsonb)
* `made_for_kids`: BOOLEAN (DEFAULT TRUE NOT NULL) -- Obligatorio COPPA
* `privacy_status`: "PrivacyStatus" (DEFAULT 'PRIVATE' NOT NULL)
* `category_id`: VARCHAR(20) (DEFAULT '1') -- Film & Animation
* `thumbnail_overlay_text`: VARCHAR(100)
* `recommended_playlist`: VARCHAR(255)
* `coppa_compliance_confirmed`: BOOLEAN (DEFAULT TRUE NOT NULL)
* `scheduled_at`: TIMESTAMPTZ
* `published_video_id`: VARCHAR(100)
* `published_video_url`: TEXT
* `published_at`: TIMESTAMPTZ
* `created_at`: TIMESTAMPTZ (DEFAULT NOW())
* `updated_at`: TIMESTAMPTZ (DEFAULT NOW())

#### `cost_metrics`
* `id`: UUID (PK)
* `episode_id`: UUID (FK `episodes.id`, ON DELETE CASCADE)
* `job_id`: UUID (FK `production_jobs.id`, ON DELETE SET NULL)
* `provider`: VARCHAR(50) (NOT NULL) -- 'GEMINI', 'IMAGEN', 'GOOGLE_TTS'
* `operation`: VARCHAR(50) (NOT NULL) -- 'STORY_GEN', 'QC_AUDIT', 'TTS_SYNTHESIS'
* `input_tokens`: INT (DEFAULT 0)
* `output_tokens`: INT (DEFAULT 0)
* `image_count`: INT (DEFAULT 0)
* `audio_seconds`: INT (DEFAULT 0)
* `cost_eur`: NUMERIC(10, 6) (NOT NULL)
* `model_name`: VARCHAR(100) (NOT NULL)
* `created_at`: TIMESTAMPTZ (DEFAULT NOW())
* *Índice:* `CREATE INDEX idx_cost_metrics_episode ON cost_metrics(episode_id);`

---

## 12. SUPERFICIES DE SEGURIDAD & FRONTERAS DE CONFIANZA

Para proteger los activos y cumplir normativas internacionales:

1. **Tokens OAuth Cifrados en Reposo:** Prohibición absoluta de almacenar `access_token` o `refresh_token` en texto plano. Se utilizará cifrado autenticado AES-256-GCM con una clave maestra inyectada exclusivamente por entorno (`ENCRYPTION_SECRET`).
2. **Safe Harbor & COPPA Enforcement:** El valor `madeForKids: true` se fija inmutablemente a nivel de esquema en la base de datos para evitar que un error humano o manipulación de API pública desactive la protección infantil.
3. **Visibilidad Privada Obligatoria:** La publicación directa en estado `PUBLIC` está bloqueada por diseño; todas las emisiones se crean en estado `PRIVATE` o `SCHEDULED`, requiriendo confirmación expresa.
4. **Sanitización de Prompts y Salidas:** Las respuestas generativas de Gemini se validan con Zod antes de ingresar a la base de datos para prevenir inyecciones de contenido no deseado en narrativas dirigidas a preescolares.
5. **Aislamiento de Storage:** Ninguna ruta interna del sistema operativo se expone a clientes; la API entrega URLs públicas o pre-firmadas gestionadas por `StorageProvider`.

---

## 13. RESOLUCIÓN DE DECISIONES DE DISEÑO (CONSOLIDACIÓN PHASE 01.1 & 01.2)

> Documento de cierre definitivo: [docs/PHASE_01_2_DOMAIN_CLOSURE.md](file:///c:/Users/Glado/CartoonFactory/docs/PHASE_01_2_DOMAIN_CLOSURE.md)

Las decisiones de arquitectura de dominio han sido zanjadas y formalizadas:

| ID | Asunto | Resolución Arquitectónica Adoptada | Justificación |
| :--- | :--- | :--- | :--- |
| **ADR-06** | **Personajes** | **`CharacterDefinition` (Series) + `EpisodeCharacter` (Episode)** | Separación de biblia maestra inmutable y variaciones de vestuario/acting por capítulo. |
| **ADR-07** | **Orden de Escenas** | **`scene_index INT` con `UNIQUE(episode_id, scene_index)`** | Orden determinista indexado por B-Tree con reordenación transaccional atómica. |
| **ADR-08** | **Reanudabilidad de Jobs** | **`ProductionJob` + `JobStep` con `input_hash`** | Idempotencia y reanudación granular por hash de inputs sin reiniciar renders desde cero. |
| **ADR-09** | **Calidad & COPPA** | **`QCReport` + `QCCheck` (Normalizado, sin Engagement)** | Validación de reglas COPPA y técnicas; estado global derivado (`approved` = 0 fallos críticos). |
| **ADR-10** | **Ownership YouTube/OAuth** | **`GoogleOAuthAccount` ──► `YouTubeChannelConnection` ──► `YouTubeChannel`** | Canales con múltiples gestores autorizados; refresh tokens exclusivamente en backend. |
| **ADR-11** | **Telemetría & Costes** | **`ProviderExecution` (cost_eur nullable)** | Telemetría técnica separada de contabilidad financiera; erradica tabla duplicada `cost_metrics`. |
| **ADR-12** | **Versionado Multimedia**| **`Asset` (Lógico) + `AssetVersion` (Inmutable append-only)** | Trazabilidad exacta de hashes SHA-256 y reproducibilidad de renders. |
| **ADR-13** | **Snapshot de Inputs**  | **`EpisodeVersion` (Reproducible Input State)** | Congelación inmutable de inputs para renderizado sin colisiones por edición concurrente en UI. |
| **ADR-14** | **Calendario Editorial** | **`EditorialCalendarItem` (Tabla física persistente)** | Intención editorial independiente de la configuración o estado técnico de YouTube. |

---

## 14. CONCLUSIÓN DE PHASE 01, 01.1 & 01.2

El dominio de Cartoon Studio queda definitivamente cerrado:
1. La jerarquía troncal es **`Series` ──► `Episode`**.
2. El esquema relacional definitivo consta de **20 tablas físicas normalizadas en 3ª Forma Normal**.
3. Se garantizan la inmutabilidad de assets generados por IA, la reanudabilidad de jobs pesados por `input_hash`, la separación de estados editoriales vs técnicos y la protección de credenciales OAuth en backend.
4. El sistema queda listo para proceder, tras la aprobación explícita del usuario, a la **PHASE 02 — POSTGRESQL & PERSISTENCE ENGINE**.
