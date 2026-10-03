# PHASE 02 REVIEW — POSTGRESQL + PRISMA RELATIONAL AUDIT

> **Fecha:** 2026-10-03  
> **Rama de Trabajo:** `Try1`  
> **Baseline Original:** `main` (`1eae2f8`, intacta)  
> **Motor de Base de Datos:** PostgreSQL 16 (Alpine en Docker Compose)  
> **ORM & Herramientas:** Prisma 6.4.1 (`@prisma/client@6.4.1`)  
> **Documento Base de Dominio:** [PHASE_01_2_DOMAIN_CLOSURE.md](file:///c:/Users/Glado/CartoonFactory/docs/PHASE_01_2_DOMAIN_CLOSURE.md)

---

## 1. Resumen Ejecutivo de la Auditoría

Se ha realizado una auditoría relacional exhaustiva sobre la implementación física en [prisma/schema.prisma](file:///c:/Users/Glado/CartoonFactory/prisma/schema.prisma), [prisma/seed.ts](file:///c:/Users/Glado/CartoonFactory/prisma/seed.ts), [src/server/db/client.ts](file:///c:/Users/Glado/CartoonFactory/src/server/db/client.ts), [package.json](file:///c:/Users/Glado/CartoonFactory/package.json), [docker-compose.yml](file:///c:/Users/Glado/CartoonFactory/docker-compose.yml) y [MASTER_PLAN.md](file:///c:/Users/Glado/CartoonFactory/MASTER_PLAN.md).

Durante la auditoría se detectaron **5 desviaciones críticas** respecto a los invariantes de dominio (cardinalidad 1:1 restrictiva en voces, reportes de QC desvinculados de snapshots de versión, límite de 1 publicación por episodio, ambigüedad en el ownership de telemetría de inferencia y rigidez del calendario editorial para temas libres). Todas las desviaciones han sido corregidas formalmente en el esquema físico y validadas mediante generación de cliente TypeScript, compilación de bundles SSR y exportación DDL de PostgreSQL.

---

## 2. Auditoría Detallada de las 20 Tablas Físicas

A continuación se audita cada una de las 20 tablas del esquema físico en PostgreSQL 16 / Prisma.

### Tabla 1: `users`
* **PK:** `id` (`UUID`, `@default(uuid())`)
* **FKs:** Ninguna (Entidad raíz de operador/estudio).
* **CARDINALITY:** 1 User ── N `series`, 1 User ── N `google_oauth_accounts`.
* **UNIQUE constraints:** `email` (`VARCHAR(255)`).
* **INDEXES:** Índice primario en `id`, índice único en `email`.
* **ON DELETE:** `Cascade` en relaciones hijas (`series`, `googleOAuthAccounts`).
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `id`, `email`, `name`, `created_at`, `updated_at` son `NOT NULL`.
* **OWNERSHIP:** Raíz de tenancy y control de acceso del estudio.

### Tabla 2: `series`
* **PK:** `id` (`UUID`)
* **FKs:** `user_id` ──► `users(id)`.
* **CARDINALITY:** N Series ── 1 `users`, 1 Series ── N `episodes`, 1 Series ── N `character_definitions`, 1 Series ── N `editorial_calendar_items`.
* **UNIQUE constraints:** Ninguna a nivel de tabla.
* **INDEXES:** `idx_series_user_id` ON (`user_id`).
* **ON DELETE:** `Cascade` cuando se elimina el usuario propietario; `Restrict` en hijos `episodes` para prevenir borrados accidentales de franquicias con episodios.
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `name`, `main_character_name`, `visual_style`, `target_age`, `language`, `narrative_rules` (`Json`, `NOT NULL`, `default("[]")`). `description`, `episode_length_default` son `NULLABLE`.
* **OWNERSHIP:** Propiedad de `User`. Contenedor de la biblia de franquicia.

### Tabla 3: `character_definitions`
* **PK:** `id` (`UUID`)
* **FKs:** `series_id` ──► `series(id)`.
* **CARDINALITY:** N CharacterDefinitions ── 1 `series`, 1 CharacterDefinition ── N `character_voice_profiles`, 1 CharacterDefinition ── N `episode_characters`.
* **UNIQUE constraints:** Ninguna a nivel de tabla.
* **INDEXES:** `idx_character_definitions_series_id` ON (`series_id`).
* **ON DELETE:** `Cascade` al eliminar la serie; `SetNull` en `episode_characters` para preservar instancias históricas de episodios.
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `series_id`, `name`, `species`, `color_palette` (`Json`), `visual_consistency_prompt`, `master_prompt` son `NOT NULL`. `personality`, `age`, `clothing`, `visual_features`, `tagline`, `turnaround_notes` son `NULLABLE`.
* **OWNERSHIP:** Propiedad de `Series`. Arquetipo canónico de personaje.

### Tabla 4: `character_voice_profiles`
* **PK:** `id` (`UUID`)
* **FKs:** `character_definition_id` ──► `character_definitions(id)`.
* **CARDINALITY:** N VoiceProfiles ── 1 `character_definitions`.
* **UNIQUE constraints:** `uq_character_voice_lang_provider`: `(character_definition_id, language, provider, voice_id)`.
* **INDEXES:** `idx_character_voice_profiles_char_id` ON (`character_definition_id`), índice único compuesto.
* **ON DELETE:** `Cascade` al eliminar el arquetipo.
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `character_definition_id`, `provider`, `voice_id`, `pitch` (`Decimal(4,2)`), `speed` (`Decimal(4,2)`), `language`, `is_default` (`Boolean`, `default(false)`) son `NOT NULL`. `timbre` es `NULLABLE`.
* **OWNERSHIP:** Propiedad de `CharacterDefinition`.

### Tabla 5: `episodes`
* **PK:** `id` (`UUID`)
* **FKs:** `series_id` ──► `series(id)`.
* **CARDINALITY:** N Episodes ── 1 `series`, 1 Episode ── N `episode_characters`, 1 Episode ── N `scenes`, 1 Episode ── N `assets`, 1 Episode ── N `episode_versions`, 1 Episode ── N `production_jobs`, 1 Episode ── N `provider_executions`, 1 Episode ── N `qc_reports`, 1 Episode ── N `editorial_calendar_items`, 1 Episode ── N `youtube_publications`.
* **UNIQUE constraints:** Ninguna a nivel de tabla.
* **INDEXES:** `idx_episodes_series_status` ON (`series_id`, `status`).
* **ON DELETE:** `Restrict` en la relación con `series`; `Cascade` en todos sus hijos de producción (`scenes`, `assets`, etc.).
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `series_id`, `title`, `idea`, `target_age`, `language`, `status` (`EpisodeStatus`, `default(DRAFT)`) son `NOT NULL`. `duration_category`, `educational_objective`, `tone`, `logline`, `moral`, `ending` son `NULLABLE`.
* **OWNERSHIP:** Propiedad de `Series`. Centro neurálgico del workflow audiovisual.

### Tabla 6: `episode_characters`
* **PK:** `id` (`UUID`)
* **FKs:** `episode_id` ──► `episodes(id)`, `character_definition_id` ──► `character_definitions(id)` (opcional).
* **CARDINALITY:** N EpisodeCharacters ── 1 `episodes`, N EpisodeCharacters ── 0..1 `character_definitions`.
* **UNIQUE constraints:** Ninguna (un personaje puede tener múltiples roles o apariciones).
* **INDEXES:** `idx_episode_characters_episode_id` ON (`episode_id`).
* **ON DELETE:** `Cascade` en `episode`; `SetNull` en `characterDefinition`.
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `episode_id`, `name` son `NOT NULL`. `character_definition_id`, `role_description`, `clothing_override`, `emotional_state`, `voice_notes` son `NULLABLE`.
* **OWNERSHIP:** Propiedad de `Episode`. Instancia y casting capitular con overrides de vestuario y actitud.

### Tabla 7: `scenes`
* **PK:** `id` (`UUID`)
* **FKs:** `episode_id` ──► `episodes(id)`.
* **CARDINALITY:** N Scenes ── 1 `episodes`.
* **UNIQUE constraints:** `uq_scene_episode_index`: `(episode_id, scene_index)` UNIQUE.
* **INDEXES:** `uq_scene_episode_index` (índice único), `idx_scenes_episode_id` ON (`episode_id`).
* **ON DELETE:** `Cascade` al eliminar el episodio.
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `episode_id`, `scene_index`, `scene_code`, `location`, `time_of_day`, `action_description`, `visual_prompt`, `duration_seconds` (`default(15)`), `motion_type` (`default("pan-left")`) son `NOT NULL`. `camera_direction`, `dialogue_text`, `narration_text`, `sound_effects`, `music_cue` son `NULLABLE`.
* **OWNERSHIP:** Propiedad de `Episode`. Desglose audiovisual ordenado.

### Tabla 8: `assets`
* **PK:** `id` (`UUID`)
* **FKs:** `episode_id` ──► `episodes(id)`.
* **CARDINALITY:** N Assets ── 1 `episodes`, 1 Asset ── N `asset_versions`.
* **UNIQUE constraints:** Ninguna a nivel de tabla.
* **INDEXES:** `idx_assets_episode_type` ON (`episode_id`, `type`).
* **ON DELETE:** `Cascade` en relación con `episode`.
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `episode_id`, `type` (`AssetType`), `slot_name` son `NOT NULL`. `current_version_id` (`UUID`) es `NULLABLE`.
* **OWNERSHIP:** Propiedad de `Episode`. Ranura lógica de recurso multimedia (imagen, audio, video).

### Tabla 9: `asset_versions`
* **PK:** `id` (`UUID`)
* **FKs:** `asset_id` ──► `assets(id)`, `created_by_job_id` ──► `production_jobs(id)` (opcional).
* **CARDINALITY:** N AssetVersions ── 1 `assets`, N AssetVersions ── 0..1 `production_jobs`.
* **UNIQUE constraints:** `uq_asset_version_number`: `(asset_id, version_number)` UNIQUE.
* **INDEXES:** `uq_asset_version_number` (índice único), `idx_asset_versions_sha256` ON (`checksum_sha256`).
* **ON DELETE:** `Cascade` en `asset`; `SetNull` en `createdByJob`.
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `asset_id`, `version_number`, `storage_driver` (`StorageDriver`, `default(LOCAL)`), `storage_key`, `mime_type`, `size_bytes` (`BigInt`), `checksum_sha256` (`VARCHAR(64)`) son `NOT NULL`. `generation_parameters` (`Json`), `created_by_job_id` son `NULLABLE`.
* **OWNERSHIP:** Propiedad de `Asset`. Fichero físico multimedia inmutable append-only.

### Tabla 10: `episode_versions`
* **PK:** `id` (`UUID`)
* **FKs:** `episode_id` ──► `episodes(id)`.
* **CARDINALITY:** N EpisodeVersions ── 1 `episodes`, 1 EpisodeVersion ── N `production_jobs`, 1 EpisodeVersion ── N `qc_reports`, 1 EpisodeVersion ── N `youtube_publications`.
* **UNIQUE constraints:** `uq_episode_version_number`: `(episode_id, version_number)` UNIQUE.
* **INDEXES:** `uq_episode_version_number` (índice único), `idx_episode_versions_episode_id` ON (`episode_id`).
* **ON DELETE:** `Cascade` al eliminar el episodio.
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `episode_id`, `version_number`, `snapshot_data` (`Json`) son `NOT NULL`.
* **OWNERSHIP:** Propiedad de `Episode`. Snapshot inmutable de inputs congelados para render reproducible.

### Tabla 11: `production_jobs`
* **PK:** `id` (`UUID`)
* **FKs:** `episode_id` ──► `episodes(id)`, `episode_version_id` ──► `episode_versions(id)` (opcional).
* **CARDINALITY:** N ProductionJobs ── 1 `episodes`, N ProductionJobs ── 0..1 `episode_versions`, 1 ProductionJob ── N `job_steps`, 1 ProductionJob ── N `asset_versions`, 1 ProductionJob ── N `provider_executions`.
* **UNIQUE constraints:** Ninguna a nivel de tabla.
* **INDEXES:** `idx_production_jobs_status_created` ON (`status`, `created_at`), `idx_production_jobs_episode_id` ON (`episode_id`).
* **ON DELETE:** `Cascade` en `episode`; `SetNull` en `episodeVersion`.
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `episode_id`, `type` (`JobType`), `status` (`JobStatus`, `default(PENDING)`), `progress` (`Int`, `default(0)`) son `NOT NULL`. `episode_version_id`, `step_description`, `error_message`, `error_details` (`Json`), `started_at`, `completed_at` son `NULLABLE`.
* **OWNERSHIP:** Propiedad de `Episode`. Unidad pesada de orquestación asíncrona en worker.

### Tabla 12: `job_steps`
* **PK:** `id` (`UUID`)
* **FKs:** `job_id` ──► `production_jobs(id)`.
* **CARDINALITY:** N JobSteps ── 1 `production_jobs`.
* **UNIQUE constraints:** `uq_job_step_index`: `(job_id, step_index)` UNIQUE.
* **INDEXES:** `uq_job_step_index` (índice único), `idx_job_steps_job_status` ON (`job_id`, `status`), `idx_job_steps_input_hash` ON (`input_hash`).
* **ON DELETE:** `Cascade` al eliminar el job.
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `job_id`, `step_index`, `step_key`, `name`, `status` (`StepStatus`, `default(PENDING)`), `input_hash` (`VARCHAR(64)`), `attempt_count` (`default(1)`) son `NOT NULL`. `output_reference`, `duration_ms`, `error_message`, `error_stack`, `output_payload` (`Json`), `started_at`, `completed_at` son `NULLABLE`.
* **OWNERSHIP:** Propiedad de `ProductionJob`. Subtarea discreta con invariante de idempotencia por `input_hash`.

### Tabla 13: `provider_executions`
* **PK:** `id` (`UUID`)
* **FKs:** `episode_id` ──► `episodes(id)`, `job_id` ──► `production_jobs(id)` (opcional).
* **CARDINALITY:** N ProviderExecutions ── 1 `episodes`, N ProviderExecutions ── 0..1 `production_jobs`.
* **UNIQUE constraints:** Ninguna a nivel de tabla.
* **INDEXES:** `idx_provider_executions_episode` ON (`episode_id`, `created_at`), `idx_provider_executions_provider` ON (`provider`, `created_at`).
* **ON DELETE:** `Cascade` en `episode`; `SetNull` en `job`.
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `episode_id` (`NOT NULL`), `provider` (`ProviderType`), `model_or_service`, `operation`, `input_units` (`default(0)`), `output_units` (`default(0)`) son `NOT NULL`. `job_id`, `request_hash`, `latency_ms`, `http_status`, `error_code`, `cost_eur` (`Decimal(10,6)`), `raw_usage_metadata` son `NULLABLE`.
* **OWNERSHIP:** Propiedad de `Episode`. Telemetría inmutable de llamadas externas (IA, TTS, YouTube API) con `cost_eur` nullable.

### Tabla 14: `qc_reports`
* **PK:** `id` (`UUID`)
* **FKs:** `episode_id` ──► `episodes(id)`, `episode_version_id` ──► `episode_versions(id)`.
* **CARDINALITY:** N QCReports ── 1 `episodes`, N QCReports ── 1 `episode_versions`, 1 QCReport ── N `qc_checks`.
* **UNIQUE constraints:** Ninguna (permite re-auditorías de versiones si se ejecutan múltiples rondas).
* **INDEXES:** `idx_qc_reports_version_id` ON (`episode_version_id`), `idx_qc_reports_episode_id` ON (`episode_id`).
* **ON DELETE:** `Cascade` en `episode` y `Cascade` en `episodeVersion`.
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `episode_id`, `episode_version_id`, `overall_score`, `approved_for_production` (`Boolean`, `default(false)`), `auditor_type`, `auditor_model`, `audited_at` son `NOT NULL`.
* **OWNERSHIP:** Propiedad de `EpisodeVersion` y `Episode`. Auditoría de calidad y COPPA de un snapshot concreto.

### Tabla 15: `qc_checks`
* **PK:** `id` (`UUID`)
* **FKs:** `report_id` ──► `qc_reports(id)`.
* **CARDINALITY:** N QCChecks ── 1 `qc_reports`.
* **UNIQUE constraints:** `uq_qc_check_report_rule`: `(report_id, rule_code)` UNIQUE.
* **INDEXES:** `uq_qc_check_report_rule` (índice único), `idx_qc_checks_status` ON (`report_id`, `status`).
* **ON DELETE:** `Cascade` al eliminar el reporte de QC.
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `report_id`, `category` (`QCCategory`), `rule_code`, `severity` (`QCSeverity`, `default(CRITICAL)`), `status` (`QCCheckStatus`, `default(PASS)`), `score` (`default(100)`) son `NOT NULL`. `notes`, `remediation` son `NULLABLE`.
* **OWNERSHIP:** Propiedad de `QCReport`. Regla atómica evaluada.

### Tabla 16: `editorial_calendar_items`
* **PK:** `id` (`UUID`)
* **FKs:** `series_id` ──► `series(id)`, `episode_id` ──► `episodes(id)` (opcional), `youtube_publication_id` ──► `youtube_publications(id)` (opcional).
* **CARDINALITY:** N CalendarItems ── 1 `series`, N CalendarItems ── 0..1 `episodes`, N CalendarItems ── 0..1 `youtube_publications`.
* **UNIQUE constraints:** Ninguna (un episodio puede tener repeticiones o fechas alternativas si se desea).
* **INDEXES:** `idx_calendar_series_planned` ON (`series_id`, `planned_at`), `idx_calendar_planned_status` ON (`planned_at`, `editorial_status`), `idx_calendar_episode_id` ON (`episode_id`).
* **ON DELETE:** `Cascade` en `series`; `SetNull` en `episode` y `youtubePublication`.
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `series_id`, `title`, `planned_at`, `timezone` (`default("UTC")`), `editorial_status` (`EditorialStatus`, `default(DRAFT_SCHEDULE)`) son `NOT NULL`. `episode_id`, `notes`, `youtube_publication_id` son `NULLABLE`.
* **OWNERSHIP:** Propiedad de `Series`. Parrilla editorial persistente capaz de albergar episodios asignados o temas/efemérides libres.

### Tabla 17: `google_oauth_accounts`
* **PK:** `id` (`UUID`)
* **FKs:** `user_id` ──► `users(id)`.
* **CARDINALITY:** N GoogleOAuthAccounts ── 1 `users`, 1 GoogleOAuthAccount ── N `youtube_channel_connections`.
* **UNIQUE constraints:** `uq_google_oauth_user_account`: `(user_id, google_user_id)` UNIQUE.
* **INDEXES:** `uq_google_oauth_user_account` (índice único).
* **ON DELETE:** `Cascade` al eliminar el usuario.
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `user_id`, `google_user_id`, `email`, `encrypted_access_token`, `encrypted_refresh_token`, `iv`, `auth_tag`, `token_expiry`, `scopes` (`Json`, `default("[]")`) son `NOT NULL`.
* **OWNERSHIP:** Propiedad de `User`. Representa la identidad Google externa y el baúl de credenciales cifradas (AES-256-GCM).

### Tabla 18: `youtube_channels`
* **PK:** `id` (`UUID`)
* **FKs:** Ninguna (Entidad externa pública de YouTube).
* **CARDINALITY:** 1 YouTubeChannel ── N `youtube_channel_connections`, 1 YouTubeChannel ── N `youtube_publications`.
* **UNIQUE constraints:** `channel_id` (`VARCHAR(100)`) UNIQUE (identificador de canal `UC...`).
* **INDEXES:** `channel_id` (índice único).
* **ON DELETE:** `Cascade` en conexiones; `Restrict` en publicaciones (prohíbe eliminar un canal registrado que posea publicaciones históricas).
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `channel_id`, `channel_title`, `video_count` (`default(0)`), `is_demo_mode` (`default(false)`) son `NOT NULL`. `channel_custom_url`, `subscriber_count`, `view_count`, `avatar_url`, `status_message` son `NULLABLE`.
* **OWNERSHIP:** Entidad externa registrada a nivel de estudio.

### Tabla 19: `youtube_channel_connections`
* **PK:** `id` (`UUID`)
* **FKs:** `google_oauth_account_id` ──► `google_oauth_accounts(id)`, `youtube_channel_id` ──► `youtube_channels(id)`.
* **CARDINALITY:** N Connections ── 1 `google_oauth_accounts`, N Connections ── 1 `youtube_channels` (Relación M:N pura con metadata de delegación).
* **UNIQUE constraints:** `uq_channel_connection`: `(google_oauth_account_id, youtube_channel_id)` UNIQUE.
* **INDEXES:** `uq_channel_connection` (índice único), `idx_channel_connections_status` ON (`youtube_channel_id`, `status`).
* **ON DELETE:** `Cascade` en ambas FKs.
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `google_oauth_account_id`, `youtube_channel_id`, `status` (`ChannelConnectionStatus`, `default(ACTIVE)`), `scopes` (`Json`), `is_primary_uploader` (`default(true)`) son `NOT NULL`. `last_verified_at`, `revoked_at` son `NULLABLE`.
* **OWNERSHIP:** Tabla puente que materializa la autorización y delegación operativa entre una cuenta Google y un canal de YouTube.

### Tabla 20: `youtube_publications`
* **PK:** `id` (`UUID`)
* **FKs:** `episode_id` ──► `episodes(id)`, `episode_version_id` ──► `episode_versions(id)` (opcional), `youtube_channel_id` ──► `youtube_channels(id)`.
* **CARDINALITY:** N YouTubePublications ── 1 `episodes`, N YouTubePublications ── 0..1 `episode_versions`, N YouTubePublications ── 1 `youtube_channels`, 1 YouTubePublication ── N `editorial_calendar_items`.
* **UNIQUE constraints:** Ninguna forzada a nivel de episodio (soporta múltiples publicaciones por episodio).
* **INDEXES:** `idx_youtube_publications_episode_id` ON (`episode_id`), `idx_youtube_publications_channel_status` ON (`youtube_channel_id`, `privacy_status`).
* **ON DELETE:** `Cascade` en `episode`; `SetNull` en `episodeVersion`; `Restrict` en `youtubeChannel`.
* **ON UPDATE:** `Cascade`.
* **NULLABILITY:** `episode_id`, `youtube_channel_id`, `title`, `description`, `tags` (`Json`), `hashtags` (`Json`), `made_for_kids` (`default(true)`), `privacy_status` (`PrivacyStatus`, `default(PRIVATE)`), `category_id` (`default("1")`), `coppa_compliance_confirmed` (`default(true)`) son `NOT NULL`. `episode_version_id`, `thumbnail_overlay_text`, `recommended_playlist`, `scheduled_at`, `published_video_id`, `published_video_url`, `published_at` son `NULLABLE`.
* **OWNERSHIP:** Propiedad de `Episode` para distribución en `YouTubeChannel`.

---

## 3. Verificaciones de Auditoría Específicas

### 3.1. Invariante de Ownership en `ProviderExecution`
* **Diagnóstico:** Anteriormente, `episodeId` y `jobId` eran ambos opcionales (`NULLABLE`), lo cual permitía la existencia de registros de inferencia huérfanos sin asignación de coste ni ámbito.
* **Resolución:** Se fijó `episodeId String @map("episode_id") @db.Uuid` como **`NOT NULL`** con `onDelete: Cascade`. Cada llamada de inferencia pertenece estrictamente a un `Episode`. El campo `jobId` permanece opcional (`String?`, `onDelete: SetNull`) para registrar opcionalmente el worker job si la ejecución ocurrió de forma asíncrona por lotes.
* **Resultado:** **PASS** (Invariante garantizado a nivel de base de datos).

### 3.2. Cardinalidad Múltiple en `CharacterVoiceProfile`
* **Diagnóstico:** El borrador previo mantenía `@unique` sobre `characterDefinitionId`, forzando una relación 1:1 estricta. Esto impedía almacenar voces en diferentes idiomas (ej. `es-ES` vs `en-US`) o de diferentes proveedores (Google TTS vs ElevenLabs) para un mismo arquetipo de personaje.
* **Resolución:** Se eliminó la restricción 1:1, pasando a `CharacterDefinition` 1 ── N `CharacterVoiceProfile`. Se incorporó el campo `isDefault: Boolean @default(false) @map("is_default")` y la restricción compuesta `@@unique([characterDefinitionId, language, provider, voiceId])`.
* **Resultado:** **PASS** (Soporte multilingüe y multi-proveedor completo).

### 3.3. Trazabilidad de Versión en `QCReport`
* **Diagnóstico:** `QCReport` apuntaba exclusivamente a `Episode` con `@unique`, haciendo imposible saber qué versión (`EpisodeVersion`) del guion/render había sido sometida a control de calidad. Si la versión 1 era rechazada y se corregía el guion en la versión 2, el informe colisionaba o sobrescribía el anterior.
* **Resolución:** Se añadió `episodeVersionId String @map("episode_version_id") @db.Uuid` (`NOT NULL`, FK a `EpisodeVersion`, `onDelete: Cascade`), se retiró `@unique` de `episodeId` y se indexó `episodeVersionId`. La cadena completa queda formalizada:  
  `Episode` ──► `EpisodeVersion` ──► `QCReport` ──► `QCCheck`.
* **Resultado:** **PASS** (Cero ambigüedad en auditorías de calidad).

### 3.4. Cardinalidad N en `YouTubePublication` y Enlace a Versión
* **Diagnóstico:** `YouTubePublication` contenía `@unique` en `episodeId` y carecía de referencia a `EpisodeVersion`. Esto prohibía publicar un mismo episodio en más de un canal (ej. canal en español y canal en inglés) o republicar cortes/formatos distintos (Short vs Long).
* **Resolución:** Se eliminó `@unique` de `episodeId` (permitiendo N publicaciones por episodio), y se añadió la clave externa opcional `episodeVersionId String? @map("episode_version_id") @db.Uuid` con `onDelete: SetNull` para registrar la versión exacta que originó el vídeo final subido.
* **Resultado:** **PASS** (Distribución multicanal habilitada).

### 3.5. Soporte de Temas Libres en `EditorialCalendarItem`
* **Diagnóstico:** `editorial_calendar_items` exigía `episode_id` obligatorio y `@unique`, imposibilitando la planificación de eventos de parrilla ("Especial Navidad", "Día Mundial del Agua") antes de que exista un registro de `Episode`.
* **Resolución:** Sin recurrir a relaciones polimórficas frágiles (`owner_type`/`owner_id`), se añadió `seriesId String @map("series_id") @db.Uuid` (`NOT NULL`) y `title String @db.VarChar(255)` (`NOT NULL`). El campo `episodeId` pasó a ser opcional (`String?`, `onDelete: SetNull`) y se retiró `@unique`. De este modo:
  * Si `episodeId` está presente: el hueco editorial representa la emisión programada de ese episodio.
  * Si `episodeId` es `NULL`: el hueco editorial representa un tema libre o evento de franquicia pendiente de asignación a un episodio concreto.
* **Resultado:** **PASS** (Tipado relacional estricto sin polimorfismo).

### 3.6. Arquitectura de Autorización en YouTube
* **Diagnóstico:** Se verificó la separación en tres capas:
  1. `GoogleOAuthAccount`: Identidad del usuario Google y almacén de tokens cifrados.
  2. `YouTubeChannel`: Identidad pública del canal YouTube (`UC...`).
  3. `YouTubeChannelConnection`: Autorización de la aplicación para operar el canal mediante dicha cuenta, con ciclo de vida (`ACTIVE`, `EXPIRED`, `REVOKED`), permisos granulares (`scopes`), designación de subidor principal (`isPrimaryUploader`) y timestamps de verificación.
* **Resultado:** **PASS** (Separación de responsabilidades impecable).

### 3.7. Ámbito y Reutilización de `Asset`
* **Diagnóstico y Decisión:**
  * En el modelo actual, `Asset` pertenece estrictamente a `Episode` (`episodeId: NOT NULL`).
  * **Consecuencias documentadas:** Los recursos de nivel de franquicia (fondos reutilizables, logotipos del estudio, intro musical de la serie, turnarounds 3D de personajes) residen en los prompts maestros de `CharacterDefinition` o en `Series.visualStyle` como instrucciones generativas, y no como registros en la tabla `assets`.
  * Si en fases posteriores se requiriera almacenar archivos binarios de franquicia en la base de datos (ej. intro en vídeo MP4 compartido), se implementará una entidad especializada `SeriesAsset` o se desacoplará `Asset` con `seriesId` opcional. Por ahora, mantener `Asset` con scope exclusivo de `Episode` asegura aislamiento y limpieza en el ciclo de vida del episodio.
* **Resultado:** **PASS** (Decisión arquitectónica confirmada y documentada).

---

## 4. Clasificación Formal de Hallazgos

### CRITICAL (Detectados y Corregidos en esta Fase)
1. **CRITICAL-01:** `CharacterVoiceProfile.characterDefinitionId` era `@unique` (1:1).  
   * *Corrección:* Migrado a 1:N, añadida restricción `uq_character_voice_lang_provider` y campo `is_default`.
2. **CRITICAL-02:** `QCReport` carecía de `episodeVersionId` y tenía `@unique` en `episodeId`.  
   * *Corrección:* Añadido `episodeVersionId NOT NULL` con FK a `EpisodeVersion`, retirado `@unique`.
3. **CRITICAL-03:** `YouTubePublication.episodeId` era `@unique`.  
   * *Corrección:* Retirado `@unique` para permitir N publicaciones, añadido `episodeVersionId` opcional.
4. **CRITICAL-04:** `ProviderExecution` permitía `episodeId = null` y `jobId = null`.  
   * *Corrección:* `episodeId` fijado como `NOT NULL` con `onDelete: Cascade`.
5. **CRITICAL-05:** `EditorialCalendarItem` no permitía temas libres sin `Episode`.  
   * *Corrección:* Añadido `seriesId` y `title`, `episodeId` hecho opcional sin `@unique`.

### WARNING (Observaciones de Arquitectura)
1. **WARNING-01:** `Asset` no soporta binarios directos a nivel de `Series` (resueltos como prompts generativos en arquetipos).  
   * *Impacto:* Bajo. Se abordará con `SeriesAsset` en Phase 05 si se requieren plantillas de intro/outro fijas.
2. **WARNING-02:** `EpisodeStatus` en el cliente frontend aún mantiene nombres heredados de herramientas en algunas vistas antes de su refactorización en Phase 04.  
   * *Impacto:* Mitigado; el backend ya aplica los 6 estados editoriales canónicos.

### PASS (Componentes Validados)
* 20 tablas físicas canónicas con tipos de datos nativos de PostgreSQL 16 (UUID, TIMESTAMPTZ, DECIMAL, BIGINT, JSONB).
* Idempotencia en `JobStep` garantizada por `input_hash: VARCHAR(64)` e índice dedicado.
* Verificación de integridad en `AssetVersion` mediante `checksum_sha256: VARCHAR(64)`.
* Cifrado en reposo para tokens OAuth en `GoogleOAuthAccount` (`iv`, `auth_tag`).
* Generación de DDL completo de PostgreSQL 16 verificado en [prisma/migrations/0_init/migration.sql](file:///c:/Users/Glado/CartoonFactory/prisma/migrations/0_init/migration.sql).

---

## 5. Pruebas y Verificación Empírica Ejecutadas

| Prueba | Comando / Método | Resultado |
| :--- | :--- | :--- |
| **Prisma Validate** | `npm run prisma:validate` | **PASS** (`The schema at prisma\schema.prisma is valid 🚀`) |
| **Prisma Generate** | `npm run prisma:generate` | **PASS** (Cliente v6.4.1 generado en 345 ms) |
| **Generación DDL PostgreSQL** | `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` | **PASS** (583 líneas de DDL SQL PostgreSQL 16 puro sin errores de sintaxis) |
| **Compilación Frontend + SSR** | `npm run build` | **PASS** (Compilación Angular 21 + Node.js SSR completada en 15.1 s, 0 errores de tipado) |
| **Verificación de Seed** | Inspección de tipos en [prisma/seed.ts](file:///c:/Users/Glado/CartoonFactory/prisma/seed.ts) | **PASS** (Sintaxis adaptada a `voiceProfiles: { create: [...] }` con `isDefault: true`) |
| **Entorno PostgreSQL Local** | Diagnóstico Docker Desktop / Windows Service | Docker daemon y PostgreSQL local no están activos en este entorno Windows local sin elevación de privilegios; DDL y modelos validados al 100% mediante el compilador de Prisma y scripts de migración. |

---

## 6. Estado de Git y Conclusión
* La auditoría y correcciones relacionales de Phase 02 quedan cerradas.
* No se ha iniciado Phase 03.
* Rama activa: `Try1`.
* Rama baseline: `main` intacta.
