# PHASE 01.1 — DOMAIN MODEL REFINEMENT
## Especificación de Refinamiento Arquitectónico y Modelo de Dominio Canónico

> **Documento:** Refinamiento del Dominio de Producción y Persistencia Relacional  
> **Fase:** Phase 01.1 (Revisión técnica previa a PostgreSQL & Prisma)  
> **Rama de Trabajo:** `Try1` (Baseline: Google AI Studio `main` @ `1eae2f8`)  
> **Perfil:** Principal Research Software Engineer & AI Systems Architect  
> **Fecha:** 3 de Octubre de 2026  
> **Estado:** Aprobado para Revisión Técnica Directa  

---

## 1. INTRODUCCIÓN & PROPÓSITO DEL REFINAMIENTO

En la Phase 01 se completó la auditoría forense del prototipo heredado de Google AI Studio, estableciendo la jerarquía fundamental `Series` ──► `Episode`. Sin embargo, un análisis de primer principio revela que un modelo relacional plano es insuficiente para soportar:

1. **Inmutabilidad y versionado de assets multimedia** generados por IA.
2. **Reproducibilidad determinista de renders** frente a ediciones concurrentes.
3. **Reanudabilidad (*resumability*) de trabajos pesados** sin reiniciar pipelines desde cero.
4. **Desacoplamiento estricto de identidades OAuth** frente a canales de YouTube.
5. **Auditoría granular de costes por inferencia** y latencias de proveedores.
6. **Integridad referencial en personajes de serie vs variantes episódicas**.

Este documento formaliza las 10 decisiones de refinamiento arquitectónico que regirán el esquema definitivo de PostgreSQL y Prisma en la Phase 02.

---

## 2. REFINAMIENTOS ARQUITECTÓNICOS DETALLADOS

```
┌────────────────────────────────────────────────────────────────────────┐
│                   MAPA DE REFINAMIENTOS DE DOMINIO                     │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Personajes:      CharacterDefinition (Master) ── EpisodeCharacter   │
│ 2. Multimedia:      Asset (Lógico) ── AssetVersion (Inmutable)        │
│ 3. Jobs Asíncronos: ProductionJob ── JobStep (Subtareas atómicas)     │
│ 4. Calidad & COPPA: QCReport (Head) ── QCCheck (Regla individual)     │
│ 5. Autorización:    GoogleOAuthAccount ── YouTubeChannel              │
│ 6. Observabilidad:  ProviderExecution (Telemetría & Coste exacto)     │
│ 7. Máquinas Estado: EpisodeStatus vs JobStatus vs PublicationStatus   │
│ 8. Freeze Técnico:  EpisodeVersion (Snapshot inmutable para Render)   │
│ 9. Planificación:   EditorialCalendarItem (Proyección virtual derivada)│
│ 10. Persistencia:   Esquema Prisma 100% normalizado en 3ª Forma Normal │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 2.1. `CharacterDefinition` vs `EpisodeCharacter`

#### Diagnóstico del Problema en Phase 01
La propuesta inicial planteaba una única tabla `characters` con columnas `series_id` y `episode_id` ambas anulables (*nullable*). Esto introduce un antipatrón relacional:
* Una fila podía representar un arquetipo permanente de la franquicia (ej. "Milo el Zorro") o una aparición secundaria de un solo capítulo (ej. "Ardilla con Bellota en Escena 3").
* Si un personaje maestro cambia de vestuario para un episodio invernal, modificar su registro corrompe la continuidad histórica de episodios anteriores.

#### Solución Canónica
Se segrega la definición maestra de la instancia de producción:

```
[Series] 1 ──── N [CharacterDefinition] (Biblia Maestra)
                         │ 1
                         │ N (instancia / override)
[Episode] 1 ──── N [EpisodeCharacter] ◄── (Personaje exclusivo episódico sin definición maestra)
```

1. **`CharacterDefinition` (Entidad Maestra de Franquicia):**
   * Pertenece a una `Series` (o al catálogo global).
   * Almacena rasgos inmutables: nombre canónico, especie, paleta de colores oficial, turnaround sheets, master prompt de consistencia 3D y perfil de voz predeterminado.
2. **`EpisodeCharacter` (Instancia en Episodio):**
   * Pertenece a un `Episode`.
   * Vincula opcionalmente a un `CharacterDefinition` (`character_definition_id` nullable para personajes episódicos de una sola aparición).
   * Permite *overrides* contextuales válidos únicamente para ese episodio: vestuario temático, variaciones de paleta, estado emocional predominante y notas de dirección de voz.

---

### 2.2. `Asset` vs `AssetVersion`

#### Diagnóstico del Problema en Phase 01
Un `Asset` apuntaba directamente a una única `storage_key`. En flujos de producción con IA generativa:
* El artista o director regenera imágenes de escena, diálogos TTS o fotogramas múltiples veces hasta alcanzar la calidad requerida.
* Sobrescribir el archivo destruye el historial y puede invalidar renders en cola; crear assets huérfanos sin relación fragmenta la biblioteca.

#### Solución Canónica (Append-Only Inmutable)
Se divide en identidad lógica y archivo físico inmutable:

1. **`Asset` (Identidad Lógica):**
   * Representa el rol del recurso en la producción (ej. *"Visual Escena 02"*, *"Voz Milo Diálogo 01"*, *"Master Render MP4"*).
   * Mantiene el tipo (`IMAGE_SCENE`, `AUDIO_VOICE`, `VIDEO_RENDER`, `SUBTITLE_SRT`, `THUMBNAIL`), metadatos estables y una clave foránea `current_version_id` a la versión activa.
2. **`AssetVersion` (Instancia Física Inmutable):**
   * Cada generación o subida produce una nueva fila inmutable:
     * `asset_id`: FK hacia el asset lógico.
     * `version_number`: Secuencial entero (1, 2, 3...).
     * `storage_driver`: `'local'` o `'s3'`.
     * `storage_key`: Ruta POSIX relativa normalizada o S3 Key.
     * `mime_type`: `image/png`, `audio/wav`, `video/mp4`, etc.
     * `size_bytes`: Tamaño físico del archivo.
     * `checksum_sha256`: Hash criptográfico del contenido para deduplicación y verificación de integridad.
     * `generation_parameters`: Parámetros exactos con los que fue generado (modelo, prompt, seed, temperatura, steps).
     * `created_by_job_id`: Trazabilidad directa con el job que lo produjo.

---

### 2.3. Necesidad y Diseño de `JobStep`

#### Diagnóstico del Problema en Phase 01
`ProductionJob` poseía únicamente un campo `progress` (0-100) y `step_description: string`.  
En trabajos de renderizado o generación audiovisual que consumen de 30 segundos a varios minutos:
* Un fallo en el 80% (por ejemplo, fallo en la multiplexación de subtítulos FFmpeg tras haber sintetizado 8 audios TTS) requería reiniciar todo el trabajo desde el inicio.
* No existía telemetría de tiempos por etapa ni posibilidad de reanudación determinista (*resumability*).

#### Solución Canónica: Subtareas Atómicas (`JobStep`)
Todo `ProductionJob` se compone de una secuencia ordenada de `JobStep`:

```
[ProductionJob: VIDEO_RENDER]
   ├── [JobStep 1: VALIDATE_AUDIO_ASSETS]    ── COMPLETED (210ms)
   ├── [JobStep 2: GENERATE_VTT_SUBTITLES]   ── COMPLETED (45ms)
   ├── [JobStep 3: FFMPEG_RENDER_SCENE_VIDS] ── COMPLETED (14200ms)
   ├── [JobStep 4: FFMPEG_CONCAT_AND_MUX]    ── COMPLETED (5100ms)
   └── [JobStep 5: STORAGE_UPLOAD_MP4]       ── COMPLETED (820ms)
```

Campos de `JobStep`:
* `id`: UUID.
* `job_id`: FK `production_jobs.id` (ON DELETE CASCADE).
* `step_index`: Entero secuencial (0, 1, 2...).
* `name`: Identificador técnico del paso (`EXTRACT_FRAMES`, `SYNTHESIZE_TTS`, `FFMPEG_ENCODE`, `S3_PUT`).
* `status`: `PENDING` | `RUNNING` | `COMPLETED` | `FAILED` | `SKIPPED`.
* `duration_ms`: Duración precisa de ejecución.
* `error_message` y `error_stack`: Información técnica en caso de aborto.
* `output_payload`: JSONB con identificadores generados en el paso (ej. IDs de assets producidos).

**Propiedad Arquitectónica:** Si un job falla y se solicita reintento, el runner del worker consulta los `JobStep` previos y salta directamente los pasos en estado `COMPLETED`, logrando **idempotencia y tolerancia a fallos transitorios**.

---

### 2.4. `QCReport` vs `QCCheck`

#### Diagnóstico del Problema en Phase 01
`QCReport` acumulaba múltiples categorías en columnas JSONB semi-estructuradas (`story_coherence`, `safety_coppa`, etc.).  
Esto impedía:
* Consultar por SQL cuántos episodios violaron la directiva COPPA.
* Añadir validaciones deterministas programáticas (ej. auditar duración máxima de silencio o contraste cromático en miniaturas) junto a las validaciones de LLM.

#### Solución Canónica: Desglose Normalizado en `QCCheck`
* **`QCReport` (Cabecera de Evaluación):**
  * `id`: UUID.
  * `episode_id`: FK `episodes.id`.
  * `overall_score`: Entero 0-100.
  * `approved_for_production`: Booleano (requiere 0 fallos en reglas críticas).
  * `audited_at`: Timestamp.
  * `auditor_type`: `'AI_ENGINE'` | `'HUMAN_SUPERVISOR'`.
* **`QCCheck` (Comprobación Atómica de Regla):**
  * `id`: UUID.
  * `report_id`: FK `qc_reports.id`.
  * `category`: `COPPA_SAFETY` | `STORY_COHERENCE` | `CHARACTER_CONTINUITY` | `AUDIO_DIALOGUE` | `VISUAL_FEASIBILITY` | `YOUTUBE_ENGAGEMENT`.
  * `rule_code`: Código estándar de la regla (ej. `COPPA-01-ZERO-PERSONAL-DATA`, `SAFE-02-NO-PHYSICAL-DANGER`, `ENGAGE-01-FIRST-5S-HOOK`).
  * `severity`: `CRITICAL` (bloquea producción si falla) | `WARNING` (recomendación).
  * `status`: `PASS` | `WARNING` | `FAIL`.
  * `score`: 0-100.
  * `notes`: Explicación técnica del evaluador.
  * `remediation`: Sugerencia de corrección automática o manual.

---

### 2.5. Ownership y Modelo de `YouTubeOAuthCredential`

#### Diagnóstico del Problema en Phase 01
Se asoció `YouTubeOAuthCredential` directamente a `YouTubeChannel` en relación 1:1.  
En el protocolo OAuth 2.0 de Google:
* Un usuario se autentica con una cuenta Google (`GoogleAccount`), la cual puede poseer o administrar **múltiples canales de YouTube** (canal principal, canales de marca / *Brand Accounts*).
* Si las credenciales viven en el canal, revocar o renovar tokens duplica accesos o desincroniza refresh tokens compartidos.

#### Solución Canónica
Se introduce `GoogleOAuthAccount` como entidad intermedia propiedad del usuario:

```
[User] 1 ──── N [GoogleOAuthAccount] (Credencial Cifrada AES-256-GCM)
                        │ 1
                        │ N
                [YouTubeChannel] (Canal administrado)
                        │ 1
                        │ N
             [YouTubePublication] (Publicación de un episodio)
```

1. **`GoogleOAuthAccount`:**
   * Pertenece al `User`.
   * Almacena el `google_user_id`, email de Google, scopes autorizados y los tokens cifrados con clave de entorno (`ENCRYPTION_SECRET`):
     * `encrypted_access_token`
     * `encrypted_refresh_token`
     * `iv` (Vector de Inicialización AES-256)
     * `auth_tag` (GCM Authentication Tag)
     * `token_expiry`
2. **`YouTubeChannel`:**
   * Pertenece a una `GoogleOAuthAccount` y representa un canal específico accesible con dicha credencial.
   * Almacena metadatos públicos de YouTube: `channel_id`, `title`, `subscriber_count`, `avatar_url`, estado sandbox/demo.
3. **`YouTubePublication`:**
   * Apunta al `YouTubeChannel` específico al cual se destina el vídeo.

---

### 2.6. Telemetría y Contabilidad Exacta: `ProviderExecution`

#### Diagnóstico del Problema en Phase 01
La tabla `cost_metrics` almacenaba únicamente totales acumulados de tokens o cómputo.  
En producción se requiere:
* Auditoría estricta de cada llamada HTTP a APIs de terceros (Gemini, Google Cloud TTS, ElevenLabs, Imagen 3, YouTube API).
* Registro de latencias para detectar degradación de servicios externos.
* Registro de códigos HTTP de error (429 Too Many Requests, 503 Service Unavailable) para afinar estrategias de backoff.

#### Solución Canónica: `ProviderExecution`
Cada invocación a un proveedor genera un registro inmutable:

* `id`: UUID.
* `job_id`: FK `production_jobs.id` (Nullable si fue llamada interactiva).
* `episode_id`: FK `episodes.id` (Nullable si fue operación de serie/canal).
* `provider`: `'GEMINI'` | `'IMAGEN'` | `'GOOGLE_TTS'` | `'ELEVENLABS'` | `'YOUTUBE_DATA_API'`.
* `model_or_service`: Identificador exacto (ej. `'gemini-3.8-flash'`, `'neural2-es-es-a'`).
* `operation`: `'GENERATE_STORY'`, `'TTS_SYNTHESIS'`, `'QC_AUDIT'`, `'VIDEO_UPLOAD'`.
* `latency_ms`: Duración de la llamada en milisegundos.
* `http_status`: Código HTTP retornado (200, 429, 500...).
* `input_units`: Conteo de unidades de entrada (tokens o caracteres).
* `output_units`: Conteo de unidades de salida (tokens, frames, segundos de audio).
* `cost_eur`: Coste calculado con precisión decimal `NUMERIC(10, 6)`.
* `raw_usage_metadata`: JSONB con la respuesta de uso nativa del proveedor (`usageMetadata`).
* `created_at`: Timestamp.

La tabla `CostMetric` de Phase 01 queda subsumida y optimizada mediante vistas indexadas sobre `ProviderExecution`.

---

### 2.7. Desacoplamiento Estricto de Estados

El estado de un episodio nunca debe reflejar un detalle transitorio del worker, ni el estado de un job debe sobreescribir el estado editorial.

#### A. `EpisodeStatus` (Ciclo de Vida Editorial / Creativo)
Representa exclusivamente la fase artística del contenido:
* `DRAFT`: Idea inicial registrada en el sistema.
* `SCRIPTING`: Guion y personajes en elaboración/edición.
* `STORYBOARDING`: Composición de escenas, visuales y cámaras.
* `VOICE_SYNC`: Ajuste de actuación vocal y doblaje.
* `RENDERING`: Episodio congelado en fase de ensamblado técnico.
* `QC_REVIEW`: Vídeo compilado bajo auditoría de calidad y COPPA.
* `APPROVED`: Aprobado para emisión o subida.
* `ARCHIVED`: Descatalogado o retirado de producción.

#### B. `JobStatus` (Ciclo de Vida Técnico del Worker)
Representa exclusivamente el estado del cómputo en cola:
* `PENDING`: Trabajo creado, esperando ser aceptado por el dispatcher.
* `QUEUED`: En cola de mensajes/Postgres esperando asignación a un worker libre.
* `PROCESSING`: Proceso en ejecución activa en `cartoon-worker`.
* `COMPLETED`: Ejecución exitosa con todos los `JobStep` completados.
* `FAILED`: Proceso abortado tras agotar reintentos técnicos.
* `CANCELLED`: Cancelado explícitamente por el operador.

#### C. `PublicationStatus` (Ciclo de Vida en Plataforma de Distribución)
Representa exclusivamente la presencia del vídeo en YouTube:
* `UNCONFIGURED`: Metadatos aún no preparados.
* `METADATA_READY`: Título SEO, tags, playlists y COPPA validados.
* `SCHEDULED`: Fecha y hora de estreno fijadas.
* `UPLOADING`: Transmisión resumable de bytes hacia YouTube API.
* `PROCESSING_YOUTUBE`: Vídeo recibido por YouTube en procesamiento de calidades (SD/HD/4K).
* `PUBLISHED_PRIVATE`: Disponible en YouTube Studio en modo privado (revisión humana obligatoria).
* `PUBLISHED_UNLISTED`: Enlace oculto para revisión externa.
* `PUBLISHED_PUBLIC`: Emitido públicamente en YouTube Kids.
* `UPLOAD_FAILED`: Fallo de API o token revocado.

---

### 2.8. Snapshot Inmutable de Inputs: `EpisodeVersion` (Reproducible Input State)

> *Nota de rigor técnico (Phase 01.2):* Congelar inputs **NO** garantiza determinismo en modelos generativos estocásticos de terceros (Gemini, Imagen 3). Garantiza un **reproducible input state** inmutable.

Antes de iniciar un trabajo pesado de renderizado (`VIDEO_RENDER`) o una auditoría formal (`QC_AUDIT`):

1. El sistema crea un `EpisodeVersion` inmutable:
   * `id`: UUID.
   * `episode_id`: FK `episodes.id`.
   * `version_number`: Secuencial entero (v1, v2, v3...).
   * `snapshot_data`: JSONB completo con el árbol congelado en ese instante exacto (guion, escenas ordenadas con duraciones, motion types, IDs y hashes SHA-256 de `asset_versions` fijas).
   * `created_at`: Timestamp.
2. El `ProductionJob` de renderizado se vincula a este `EpisodeVersion` y **consume exclusivamente los datos del snapshot**.
3. El usuario puede seguir editando el episodio en el frontend sin interferir con el render en curso.

---

### 2.9. Intención Editorial Persistente: `EditorialCalendarItem`

> *Resolución definitiva (Phase 01.2):* Se mantiene como **tabla física persistente** para modelar la intención de emisión previa e independiente del estado de YouTube.

El calendario editorial representa la **intención de programación** del showrunner:
* Contiene: `episode_id`, `planned_at` (TIMESTAMPTZ), `timezone`, `editorial_status` (`DRAFT_SCHEDULE`, `CONFIRMED`, `RESCHEDULED`, `BROADCASTED`), `notes` y referencia opcional `youtube_publication_id`.
* Se desacopla formalmente de los estados de `Episode` y `YouTubePublication`.

---

### 2.10. Evolución del Inventario hacia Phase 01.2 (20 Tablas Normalizadas)

> Inventario detallado y cierre de cardinalidades en: [docs/PHASE_01_2_DOMAIN_CLOSURE.md](file:///c:/Users/Glado/CartoonFactory/docs/PHASE_01_2_DOMAIN_CLOSURE.md)

| Concepto | Resolución en Phase 01.2 | Justificación Arquitectónica |
| :--- | :--- | :--- |
| **Personajes** | `character_definitions` + `episode_characters` | Biblia maestra de franquicia vs overrides locales por capítulo. |
| **Multimedia** | `assets` + `asset_versions` | Inmutabilidad de archivos físicos con verificación SHA-256. |
| **Jobs y Resumabilidad** | `production_jobs` + `job_steps` | Subtareas con `input_hash` para reanudación idempotente. |
| **Calidad & COPPA** | `qc_reports` + `qc_checks` | Reglas atómicas normalizadas; eliminación de engagement de QC. |
| **YouTube & OAuth** | `google_oauth_accounts` + `youtube_channels` + `youtube_channel_connections` | Múltiples cuentas Google autorizando el mismo canal de YouTube. |
| **Telemetría & Coste** | `provider_executions` | Telemetría técnica con `cost_eur` nullable (elimina `cost_metrics`). |
| **Freeze de Inputs** | `episode_versions` | Snapshot inmutable de inputs para renderizado sin colisiones en UI. |
| **Calendario** | `editorial_calendar_items` | Tabla física de intención editorial independiente de YouTube. |

---

## 3. ESQUEMA RELACIONAL REFINADO (PROPUESTA DEFINITIVA PARA PRISMA)

```
                            [users]
                               │
            ┌──────────────────┴──────────────────┐
            │ 1                                   │ 1
            ▼ N                                   ▼ N
        [series]                         [google_oauth_accounts]
            │ 1                                   │ 1
            ├─────────────────────┐               │ N
            │ N                   │ N             ▼
  [character_definitions]         │       [youtube_channels]
            ▲                     │               │ 1
            │ 0..1                │ 1             │
            │                     ▼ N             │ N
    [episode_characters] ◄─── [episodes] ◄────────┼──────┐
            │                     │ 1             │      │
            │                     ├───┐           │      │
            │                     │   │           │      │
            ▼ N                   │   ▼ N         │      │
         [scenes] ◄───────────────┘  [episode_versions]  │
            │ 1                               ▲          │
            ├──────────────┐                  │ 1        │
            │ N            │ N                │          │
         [assets]   [production_jobs] ────────┘          │
            │ 1            │ 1                           │
            │ N            ├─────────────────┐           │
    [asset_versions]       │ N               │ N         │
                      [job_steps]   [provider_executions]│
                                                         │
                                                         ▼ 1
                                               [youtube_publications]
```

---

## 4. MATRIZ DE DECISIONES TÉCNICAS (ADRs ACTUALIZADOS)

* **ADR-06 [ZANJADA]: Separación `CharacterDefinition` y `EpisodeCharacter`.**
  * *Decisión:* Las series poseen `CharacterDefinition` con prompts maestros. Los episodios poseen `EpisodeCharacter` con overrides locales.
* **ADR-07 [ZANJADA]: Orden Secuencial Determinista en Escenas.**
  * *Decisión:* Columna `scene_index INT` con constraint `UNIQUE(episode_id, scene_index)`. Reordenar escenas se gestiona mediante transacción SQL atómica.
* **ADR-08 [ZANJADA]: Subtareas y Resumabilidad con `JobStep`.**
  * *Decisión:* Todo `ProductionJob` divide su carga en `JobStep`. Reintentos de render no re-ejecutan pasos exitosos.
* **ADR-09 [ZANJADA]: Telemetría Unitaria vía `ProviderExecution`.**
  * *Decisión:* Registro transaccional por llamada a API externa con latencia, tokens, status y coste en euros.
* **ADR-10 [ZANJADA]: Versionado Inmutable de Assets.**
  * *Decisión:* `Asset` lógico con puntero a `AssetVersion`. Los archivos físicos son inmutables e identificados por SHA-256.
* **ADR-11 [ZANJADA]: Snapshots de Producción con `EpisodeVersion`.**
  * *Decisión:* Render y QC operan sobre snapshots inmutables del episodio para evitar colisiones por ediciones concurrentes.
* **ADR-12 [ZANJADA]: Calendario Editorial como Vista Proyectada.**
  * *Decisión:* Eliminar duplicidad de calendario; proyectar en tiempo de consulta sobre `episodes` y `youtube_publications`.

---

## 5. CONCLUSIÓN & DISPONIBILIDAD PARA PHASE 02

Con las especificaciones de **Phase 01.1**:
1. El modelo de dominio elimina todas las ambigüedades de cardinalidad y ownership.
2. La arquitectura garantiza tolerancia a fallos, reproducibilidad determinista y seguridad de credenciales.
3. El proyecto está formalmente listo para que se proceda, una vez que el usuario lo autorice, con la **PHASE 02 — POSTGRESQL & PERSISTENCE ENGINE** (modelado Prisma y migraciones sin improvisación).
