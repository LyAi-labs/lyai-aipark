# PHASE 01.2 — DOMAIN ARCHITECTURE CLOSURE
## Cierre Arquitectónico del Modelo de Dominio, Persistencia y Límites del Sistema

> **Documento:** Cierre Canónico de Arquitectura de Dominio (Phase 01.2)  
> **Fase:** Phase 01.2 (Resolución definitiva previa a PostgreSQL & Prisma)  
> **Rama de Trabajo:** `Try1` (Baseline: Google AI Studio `main` @ `1eae2f8`)  
> **Perfil:** Principal Research Software Engineer & AI Systems Architect  
> **Fecha:** 3 de Octubre de 2026  
> **Estado:** Cierre Definitivo de Dominio  

---

## 1. INTRODUCCIÓN & MOTIVACIÓN DEL CIERRE

Este documento resuelve y cierra de forma definitiva los 8 aspectos arquitectónicos identificados tras las fases 01 y 01.1, estableciendo un modelo formal, sin ambigüedades, desacoplado de la infraestructura y listo para su traslación 1:1 a `schema.prisma`.

---

## 2. CIERRE DE LOS 8 PUNTOS ARQUITECTÓNICOS

### 2.1. Modelo Canónico de YouTube & Google OAuth: `YouTubeChannelConnection`

#### Diagnóstico
Asumir que un canal de YouTube pertenece exclusivamente a una sola cuenta Google (`GoogleOAuthAccount 1 ── N YouTubeChannel`) no se ajusta a la realidad de YouTube:
* Un canal de marca (*Brand Account*) puede ser gestionado por múltiples usuarios y múltiples cuentas Google (administrador, editor, gestor de contenido).
* Diferentes usuarios del estudio pueden autenticar su propia cuenta Google para autorizar o refrescar permisos sobre el mismo canal de YouTube del estudio.

#### Solución Canónica: Conexión M:N Explícita
Se desacopla la **identidad del canal** de la **autorización de acceso**:

```
[User] 1 ──── N [GoogleOAuthAccount]
                       │ 1
                       │ N
         [YouTubeChannelConnection] (Vínculo de autorización / tokens)
                       │ N
                       │ 1
               [YouTubeChannel] (Entidad de canal única en el estudio)
                       │ 1
                       │ N
            [YouTubePublication] (Publicación de un episodio)
```

1. **`GoogleOAuthAccount` (Identidad de Autorización):**
   * Pertenece al `User`.
   * Almacena identificadores de Google (`google_user_id`, `email`), scopes otorgados y credenciales de acceso/refresco.
   * *Preocupación de Infraestructura/Seguridad:* Los tokens se cifran en reposo a nivel de capa de persistencia (ej. AES-256-GCM mediante claves gestionadas por variables de entorno), manteniéndose exclusivamente en el backend y nunca expuestos a clientes.
2. **`YouTubeChannel` (Canal de YouTube):**
   * Representa el canal en sí dentro del estudio (`channel_id` único global de YouTube, título, custom URL, subscriber count, avatar URL).
   * No está acoplado de forma rígida a una sola cuenta Google.
3. **`YouTubeChannelConnection` (Lifecycle de Conexión):**
   * Tabla intermedia explícita que modela la autorización activa entre una `GoogleOAuthAccount` y un `YouTubeChannel`.
   * **Campos:**
     * `id`: UUID.
     * `google_oauth_account_id`: FK `google_oauth_accounts.id`.
     * `youtube_channel_id`: FK `youtube_channels.id`.
     * `status`: Enum (`ACTIVE`, `EXPIRED`, `REVOKED`, `INSUFFICIENT_SCOPES`).
     * `scopes`: Array JSONB de scopes autorizados (ej. `youtube.upload`, `youtube.readonly`).
     * `last_verified_at`: Timestamp de última validación de token contra la API de Google.
     * `revoked_at`: Timestamp si el usuario o Google revocaron el consentimiento.
     * `is_primary_uploader`: Booleano para designar qué conexión se usa preferentemente para subir vídeos si hay más de una.
   * **Lifecycle:**
     * *Conexión:* Se crea al completar el flujo OAuth 2.0 y seleccionar/detectar el canal.
     * *Renovación:* El worker/API usa el refresh token de la cuenta asociada. Si falla con error `invalid_grant`, el estado pasa a `EXPIRED`.
     * *Revocación:* Si el usuario desvincula el canal o revoca en Google Security, pasa a `REVOKED`.
     * *Reconexión:* Un nuevo flujo OAuth actualiza el registro existente o crea una nueva conexión sin duplicar la entidad `YouTubeChannel`.

---

### 2.2. Modelo Canónico de `EpisodeStatus` (Desacoplamiento Editorial vs Técnico)

#### Diagnóstico
En versiones previas, `EpisodeStatus` replicaba los nombres de las etapas del pipeline técnico (`story`, `characters`, `storyboard`, `voice`, `animation`, `editing`).  
Esto es un error de diseño: el estado del episodio debe representar el **ciclo de vida editorial del contenido**, no la herramienta o proceso de cómputo en ejecución.

#### Solución Canónica
Se establece una máquina de estados editorial estricta para el episodio:

```
[DRAFT] ──► [READY_FOR_PRODUCTION] ──► [IN_PRODUCTION] ──► [READY_FOR_REVIEW] ──► [APPROVED] ──► [ARCHIVED]
   ▲                                                            │
   │                                                            ▼ (Rechazo QC)
   └────────────────────────────────────────────────────────────┴─ (Ajustes de guion/audio)
```

* **`DRAFT`:** Idea inicial, borrador de guion o sinopsis en elaboración por el showrunner.
* **`READY_FOR_PRODUCTION`:** Guion, escenas y parámetros validados y aprobados para entrar a la factoría técnica.
* **`IN_PRODUCTION`:** Hay jobs técnicos activos o programados (síntesis de voz, generación visual, composición o render FFmpeg).
* **`READY_FOR_REVIEW`:** Salidas de vídeo, audio y subtítulos ensambladas, listas para evaluación de calidad humana y COPPA.
* **`APPROVED`:** Control de calidad superado con éxito; episodio listo para distribución o programación en YouTube.
* **`ARCHIVED`:** Episodio retirado, emitido o cerrado para producción activa.

Las fases técnicas de cómputo pertenecen exclusivamente a **`ProductionJob.type`** y **`JobStep.name`**:
* `SCRIPTING`, `STORYBOARDING`, `VOICE_GENERATION`, `ASSET_GENERATION`, `AUDIO_COMPOSITION`, `VIDEO_COMPOSITION`, `FFMPEG_RENDER`, `VALIDATION`.

---

### 2.3. Calendario Editorial Persistente: `EditorialCalendarItem` (Intención Editorial)

#### Diagnóstico
Plantear el calendario editorial como una simple SQL View dependiente de `YouTubePublication` asume incorrectamente que solo se planifica lo que ya tiene metadatos de YouTube listos.  
En un estudio de animación real, la **planificación editorial es previa e independiente** de la distribución:
* Un showrunner programa que el episodio "Milo y el Viento" se emitirá el 15 de noviembre a las 17:00 CET, semanas antes de que el vídeo esté renderizado o de que existan metadatos en YouTube.
* La intención editorial puede retrasarse o cancelarse sin alterar la configuración de subida.

#### Solución Canónica: Entidad Persistente de Intención Editorial
Se mantiene **`editorial_calendar_items`** como tabla física independiente:

* **Campos:**
  * `id`: UUID (PK).
  * `episode_id`: UUID (FK `episodes.id`, ON DELETE CASCADE, UNIQUE). Cada episodio tiene a lo sumo una entrada activa en el calendario de estrenos.
  * `planned_at`: TIMESTAMPTZ (Fecha y hora objetivo de estreno).
  * `timezone`: VARCHAR(50) (ej. `'Europe/Madrid'`, `'America/New_York'`).
  * `editorial_status`: Enum (`DRAFT_SCHEDULE`, `CONFIRMED`, `RESCHEDULED`, `BROADCASTED`, `CANCELLED`).
  * `notes`: TEXT (Notas de programación, festivos, efemérides infantiles asociadas).
  * `youtube_publication_id`: UUID (Nullable, FK `youtube_publications.id`, ON DELETE SET NULL). Enlace opcional a la publicación real en YouTube cuando ésta se configure.
  * `created_at` / `updated_at`: TIMESTAMPTZ.

#### Separación de los Tres Planos
1. **Intención Editorial (`EditorialCalendarItem`):** Cuándo se *desea* que el episodio vea la luz en la parrilla del estudio.
2. **Estado del Episodio (`EpisodeStatus`):** En qué fase creativa o de aprobación se encuentra el archivo maestro.
3. **Estado de YouTube (`YouTubePublicationStatus`):** El estado técnico del archivo en los servidores de Google (`UPLOADING`, `PUBLISHED_PRIVATE`, `SCHEDULED`, `PUBLIC`).

---

### 2.4. Inventario Definitivo y Cierre de Tablas Relacionales

Se resuelve la inconsistencia numérica detectada en Phase 01.1. El esquema canónico definitivo consta de **17 tablas físicas**:

| # | Tabla (`TABLE`) | Propósito (`PURPOSE`) | Propietario (`OWNER`) | Relaciones (`RELATIONSHIPS`) | Clave Primaria & Únicas |
| :-: | :--- | :--- | :--- | :--- | :--- |
| **1** | **`users`** | Administradores y creadores del estudio. | Root | 1 ── N `series`, 1 ── N `google_oauth_accounts` | PK: `id`<br>UQ: `email` |
| **2** | **`series`** | Franquicia audiovisual y biblia permanente. | `users` | 1 ── N `episodes`, 1 ── N `character_definitions` | PK: `id`<br>FK: `user_id` |
| **3** | **`character_definitions`** | Arquetipos maestros y prompts 3D de franquicia. | `series` | 1 ── 1 `character_voice_profiles`, 1 ── N `episode_characters` | PK: `id`<br>FK: `series_id` |
| **4** | **`character_voice_profiles`** | Parámetros de síntesis vocal del arquetipo. | `character_definitions` | 1 ── 1 `character_definitions` | PK: `id`<br>UQ/FK: `character_definition_id` |
| **5** | **`episodes`** | Unidad central narrativa y de producción. | `series` | 1 ── N `scenes`, 1 ── N `episode_characters`, 1 ── N `assets`, 1 ── N `episode_versions`, 1 ── N `production_jobs`, 1 ── 1 `qc_reports`, 1 ── 1 `editorial_calendar_items`, 1 ── 1 `youtube_publications` | PK: `id`<br>FK: `series_id` |
| **6** | **`episode_characters`** | Instancia de personaje con overrides por episodio. | `episodes` | N ── 1 `character_definitions` (opcional), N ── 1 `episodes` | PK: `id`<br>FK: `episode_id`, `character_definition_id` (null) |
| **7** | **`scenes`** | Bloque temporal audiovisual unitario. | `episodes` | N ── 1 `episodes`, 1 ── N `assets` (roles de escena) | PK: `id`<br>FK: `episode_id`<br>UQ: `(episode_id, scene_index)` |
| **8** | **`assets`** | Identidad lógica de recurso (imagen, audio, video). | `episodes` | N ── 1 `episodes`, 1 ── N `asset_versions`, 1 ── 1 `current_version` | PK: `id`<br>FK: `episode_id`, `current_version_id` (null) |
| **9** | **`asset_versions`** | Archivo físico multimedia inmutable append-only. | `assets` | N ── 1 `assets`, N ── 1 `production_jobs` (productor) | PK: `id`<br>FK: `asset_id`, `created_by_job_id`<br>UQ: `(asset_id, version_number)` |
| **10** | **`episode_versions`** | Snapshot inmutable de inputs congelados para render. | `episodes` | N ── 1 `episodes`, 1 ── N `production_jobs` | PK: `id`<br>FK: `episode_id`<br>UQ: `(episode_id, version_number)` |
| **11** | **`production_jobs`** | Tarea pesada asíncrona encolada en el worker. | `episodes` | N ── 1 `episodes`, N ── 1 `episode_versions` (opcional), 1 ── N `job_steps`, 1 ── N `provider_executions` | PK: `id`<br>FK: `episode_id`, `episode_version_id` |
| **12** | **`job_steps`** | Subtarea discreta con input_hash y reanudabilidad. | `production_jobs` | N ── 1 `production_jobs` | PK: `id`<br>FK: `job_id`<br>UQ: `(job_id, step_index)` |
| **13** | **`provider_executions`** | Telemetría inmutable de llamada a API externa. | `production_jobs` / `episodes` | N ── 1 `production_jobs` (opcional), N ── 1 `episodes` (opcional) | PK: `id`<br>FK: `job_id`, `episode_id` |
| **14** | **`qc_reports`** | Cabecera de auditoría de calidad y COPPA. | `episodes` | 1 ── 1 `episodes`, 1 ── N `qc_checks` | PK: `id`<br>UQ/FK: `episode_id` |
| **15** | **`qc_checks`** | Evaluación atómica de regla de calidad/seguridad. | `qc_reports` | N ── 1 `qc_reports` | PK: `id`<br>FK: `report_id`<br>UQ: `(report_id, rule_code)` |
| **16** | **`editorial_calendar_items`** | Intención editorial persistente de programación. | `episodes` | 1 ── 1 `episodes`, N ── 1 `youtube_publications` (opcional) | PK: `id`<br>UQ/FK: `episode_id`<br>FK: `youtube_publication_id` |
| **17** | **`google_oauth_accounts`** | Cuenta Google autenticada con credenciales cifradas. | `users` | N ── 1 `users`, 1 ── N `youtube_channel_connections` | PK: `id`<br>FK: `user_id`<br>UQ: `(user_id, google_user_id)` |
| **18** | **`youtube_channels`** | Canal de YouTube registrado en el estudio. | Global Studio | 1 ── N `youtube_channel_connections`, 1 ── N `youtube_publications` | PK: `id`<br>UQ: `channel_id` |
| **19** | **`youtube_channel_connections`** | Autorización activa entre cuenta Google y canal. | `google_oauth_accounts` / `youtube_channels` | N ── 1 `google_oauth_accounts`, N ── 1 `youtube_channels` | PK: `id`<br>FK: `google_oauth_account_id`, `youtube_channel_id`<br>UQ: `(google_oauth_account_id, youtube_channel_id)` |
| **20** | **`youtube_publications`** | Metadatos y subida final a YouTube API. | `episodes` | 1 ── 1 `episodes`, N ── 1 `youtube_channels` | PK: `id`<br>UQ/FK: `episode_id`<br>FK: `youtube_channel_id` |

*Resolución Explícita:*
* **`CostMetric` (ELIMINADA COMO TABLA FÍSICA):** Queda reemplazada al 100% por `provider_executions`. Cada registro de `provider_executions` contiene las unidades exactas y `cost_eur`. Los agregados y presupuestos se calculan mediante consultas agregadas `SUM(cost_eur)` o vistas SQL, erradicando la duplicidad.
* **`EditorialCalendarItem` (MANTENIDA COMO TABLA FÍSICA):** Refleja la intención editorial independiente, no como vista volátil.

---

### 2.5. Corrección Terminológica: `EpisodeVersion` como Snapshot Inmutable de Inputs

#### Diagnóstico
La documentación previa utilizaba el término "reproducibilidad determinista" para referirse al renderizado.  
En sistemas basados en modelos de lenguaje o difusión generativa (Gemini, Imagen 3), **los proveedores de inferencia son estocásticos por naturaleza**. Incluso con parámetros fijados (temperatura = 0, seed fija), actualizaciones de pesos en el proveedor o variaciones de hardware pueden generar salidas no idénticas.

#### Formulación Canónica
* **Término Correcto:** **`EpisodeVersion` = Immutable Production Snapshot / Reproducible Input State**.
* **Garantía Real:**
  1. Congela el **estado exacto de los inputs** (`snapshot_data`: texto del guion, orden de escenas, duraciones, motion types, referencias exactas a `asset_versions` con sus checksums SHA-256).
  2. El proceso de ensamblado de FFmpeg (concatenación de frames, normalización de pistas de audio y mezcla de subtítulos) sí es determinista a partir de assets congelados.
  3. Si se requiere re-generar un asset sintético, el snapshot preserva el `prompt` original y la `seed`, permitiendo aproximación y trazabilidad forense, pero asumiendo explícitamente el carácter no determinista del proveedor generativo externo.

---

### 2.6. Reutilización Confiable de Pasos en `JobStep`: Detección por `input_hash`

#### Diagnóstico
Reutilizar un `JobStep` exitoso basándose únicamente en su nombre o índice es peligroso: si el usuario alteró el texto de un diálogo en la escena 3, un reintento de job podría reutilizar el audio TTS de la versión anterior.

#### Solución Canónica: Invariante por `input_hash`
Para garantizar que un `JobStep` solo se reutiliza si sus entradas son estrictamente idénticas:

```
[JobStep Execution Rule]
   Current Step Input Hash = SHA-256(step_key + canonical_json(step_input_payload))
   
   IF previous_step.status == 'COMPLETED' 
      AND previous_step.input_hash == current_step.input_hash 
      AND output_asset_exists(previous_step.output_reference):
         --> REUTILIZAR PASO (status = 'SKIPPED_REUSED')
   ELSE:
         --> EJECUTAR PASO (status = 'PROCESSING')
```

* **Estructura de `JobStep`:**
  * `step_key`: String identificador semántico del paso (ej. `tts_scene_01`, `mux_video_final`).
  * `input_hash`: VARCHAR(64) — Hash SHA-256 de los datos de entrada específicos de ese paso (texto del diálogo, pitch, speed, voice_id).
  * `output_reference`: VARCHAR(1024) — Referencia al asset resultante o clave de almacenamiento.
  * `status`: `PENDING` | `PROCESSING` | `COMPLETED` | `SKIPPED_REUSED` | `FAILED`.
  * `attempt_count`: Contador de reintentos del paso.
  * `started_at` / `completed_at` / `duration_ms`.
  * `error_message` / `error_stack`.

---

### 2.7. Rediseño del Control de Calidad: `QCReport` y Categorías Reales

#### Diagnóstico
1. `overall_score` (ej. 96/100) es un valor arbitrario que enmascara fallos graves: un episodio con 96% de puntuación general podría tener un fallo crítico de cumplimiento COPPA.
2. `YOUTUBE_ENGAGEMENT` no es una prueba de control de calidad (QC). Es una predicción editorial/analítica. Incluirla en QC corrompe el propósito de la auditoría de seguridad y emisión.

#### Solución Canónica
1. **El Estado Global es Derivado y Determinista:**
   * Un episodio **NO** se aprueba por un promedio numérico.
   * `approved_for_production: BOOLEAN` se deriva formalmente:
     $$\text{approved} = \left(\sum \text{checks con severity='CRITICAL' y status='FAIL'}\right) == 0$$
   * `overall_score` se mantiene como métrica secundaria puramente informativa/heurística (0-100), pero **nunca** gobierna la aprobación.
2. **Eliminación de `YOUTUBE_ENGAGEMENT`:**
   * Se traslada a la metadata de publicación / módulo editorial.
3. **Categorías Canónicas de QC:**
   * **`SAFETY_COMPLIANCE` (CRÍTICA):** Normativa COPPA, Safe Harbor, cero recopilación de datos, ausencia total de violencia física o peligros domésticos no supervisados.
   * **`CONTENT` (CRÍTICA):** Coherencia pedagógica, adecuación del vocabulario al rango de edad diana (2-4, 4-6, etc.), tono y arco moral.
   * **`CONTINUITY`:** Consistencia de diseño de personajes, vestuario y paletas entre escenas.
   * **`AUDIO`:** Claridad de dicción vocal, sincronía labial/diálogo, balance sonoro entre música de fondo y diálogos (evitar saturación en frecuencias agudas para niños).
   * **`VISUAL`:** Resolución, nitidez cromática, estabilidad de planos, ausencia de artefactos visuales severos en la animación.
   * **`TECHNICAL`:** Especificaciones de códec (H.264 High Profile), framerate determinista (24 o 30 fps exactos), relación de aspecto (16:9) y subtítulos WebVTT/SRT conformes a estándares.

---

### 2.8. Telemetría de Inferencia y Costes: `ProviderExecution`

#### Diagnóstico
Asumir que toda llamada a un proveedor genera un coste monetario es incorrecto (muchas operaciones se realizan con tiers gratuitos, modelos locales o servicios sin tarificación por token/llamada). Mezclar telemetría con contabilidad financiera crea duplicidades o inconsistencias.

#### Solución Canónica
* **`cost_eur` es Nullable (`NUMERIC(10, 6)`):**
  * Si la operación se realiza bajo cuota gratuita o proveedor sin coste marginal directo, `cost_eur = NULL` o `0.000000`.
* **Separación de Telemetría vs Contabilidad:**
  * **Telemetría Técnica:** Mide el rendimiento de infraestructura (`latency_ms`, `http_status`, `error_code`, `request_hash`, timestamps).
  * **Contabilidad Financiera:** Extrae el uso (`input_units`, `output_units`, `cost_eur`).
* **Erradicación de `CostMetric`:**
  * La tabla `cost_metrics` queda formalmente descartada. Cualquier informe de presupuesto autorizado vs consumido se genera mediante una agregación limpia:
    ```sql
    SELECT 
      episode_id,
      SUM(COALESCE(cost_eur, 0)) AS total_cost_eur,
      SUM(CASE WHEN provider = 'GEMINI' THEN input_units + output_units ELSE 0 END) AS total_tokens
    FROM provider_executions
    GROUP BY episode_id;
    ```

---

## 3. CONCLUSIÓN Y ESTADO DE PREPARACIÓN

Con este documento:
1. Se cierra el modelo relacional exacto (20 tablas normalizadas con claves, relaciones e índices bien definidos).
2. Se independiza la intención editorial del estado de subida a YouTube.
3. Se establece la conexión M:N para canales de YouTube con múltiples gestores.
4. Se introduce la garantía de reanudabilidad de jobs mediante `input_hash`.
5. Se corrigen las definiciones de estados y control de calidad.

El diseño del dominio está **plenamente cerrado y listo** para la **PHASE 02 — POSTGRESQL & PERSISTENCE ENGINE**.
