# PHASE 11 — Background Scheduler & Worker Queues

> **Estado del Documento:** Completado y Verificado (252 tests pasando al 100%)  
> **Perfil Operativo:** Principal Research Software Engineer & AI Systems Architect  
> **Componente:** `cartoon-worker` + PostgreSQL Job Engine + Editorial Broadcast Daemon  
> **Fecha:** 4 de Octubre de 2026  

---

## 1. Resumen Ejecutivo y Objetivos Cumplidos

La **Fase 11** implementa el subsistema de procesamiento asíncrono en segundo plano (*Background Worker Queues*) y el demonio planificador del calendario editorial (*Editorial Calendar Scheduler*).

El objetivo central ha sido eliminar cualquier bloqueo de la API HTTP principal trasladando el procesamiento pesado a colas transaccionales respaldadas por PostgreSQL y dotar al estudio de un motor desatendido capaz de monitorizar las fechas de emisión y publicar automáticamente en YouTube Studio conforme a las normativas de seguridad infantil (COPPA) y los guardarraíles deterministas de Control de Calidad (QC).

### Criterios de Aceptación Cumplidos (MASTER_PLAN.md):
1. **Motor de Jobs Desacoplado en Worker:** Backed por PostgreSQL con soporte transaccional (`production_jobs` y `job_steps`) y fallback en memoria offline-resilient para entornos sin base de datos activa.
2. **Control Estricto de Concurrencia:** Límite configurable de workers simultáneos (`WORKER_CONCURRENCY=2`), bloqueo atómico de tareas (*claim*) y prevención de duplicidad en ejecuciones paralelas.
3. **Catálogo Canónico de Handlers Asíncronos:** Soporte formal para `SCRIPTING` (Gemini 3.8 Flash), `VOICE_GENERATION` (Google Cloud TTS / PCM WAV), `ASSET_GENERATION` / `STORYBOARDING` (Imagen 3 / PNG), `FFMPEG_RENDER` (multiplexado H.264 / AAC / WebVTT), `VALIDATION` (QC Drift + COPPA) y `YOUTUBE_PUBLISH` (YouTube Data API v3).
4. **Manejo de Ciclo de Vida y Reintentos:** Estados canónicos `QUEUED ──► PROCESSING ──► COMPLETED | FAILED | CANCELLED`, soporte de cancelación por `AbortController`, y reintentos automáticos con conteo de intentos persistido.
5. **Scheduler Editorial Autónomo:** Monitoriza `editorial_calendar_items` periódicamente. Cuando `plannedAt <= NOW()` y el estado es `CONFIRMED`, evalúa el Gatekeeper de Calidad (QC); si es conforme, ejecuta la subida a YouTube, marca el item como `BROADCASTED` y vincula el ID de publicación generado.
6. **API REST y Telemetría en Tiempo Real:** Endpoints `/api/scheduler/*` protegidos por autenticación, retorno `202 Accepted` en despachos asíncronos y streaming de eventos vía Server-Sent Events (SSE).
7. **Integración en UI:** Telemetría reactiva en `CalendarView` (estado del demonio, disparador manual de sincronización y listado en vivo).
8. **Paridad y Verificación Rigurosa:** Suite de 27 pruebas específicas en [src/server/scheduler/scheduler.spec.ts](file:///c:/Users/Glado/CartoonFactory/src/server/scheduler/scheduler.spec.ts), alcanzando 252 tests globales pasando al 100% y build de producción limpio (`ng build`).

---

## 2. Topología y Arquitectura del Sistema

```
                        [HTTP CLIENT / ANGULAR SPA]
                                     │
                     POST /jobs/dispatch (202 Accepted)
                                     ▼
               ┌───────────────────────────────────────────┐
               │    EXPRESS API LAYER (schedulerRouter)    │
               │    - Validación Zod estricta              │
               │    - SSE Streaming (/jobs/:id/events)     │
               │    - CRUD Calendario Editorial            │
               └─────────────────────┬─────────────────────┘
                                     │
                        Enqueue Job  │  Query Due Items
                                     ▼
               ┌───────────────────────────────────────────┐
               │    MASTER SCHEDULER SERVICE (Singleton)   │
               │    - WorkerQueue (concurrency = 2)        │
               │    - EditorialScheduler (pollIntervalMs)  │
               └─────────┬───────────────────────┬─────────┘
                         │                       │
          Claim / Update │                       │ Auto-Broadcast
                         ▼                       ▼
           ┌──────────────────────────┐    ┌──────────────────────────┐
           │   POSTGRESQL PERSISTENCE │    │   YOUTUBE & QC GATEWAY   │
           │   - production_jobs      │    │   - qcService.audit      │
           │   - job_steps            │    │   - youTubeService.pub   │
           │   - editorial_calendar   │    │   - madeForKids: true    │
           └──────────────────────────┘    └──────────────────────────┘
```

---

## 3. Componentes Implementados

### 3.1. Tipos y Esquemas Formales ([src/server/scheduler/types.ts](file:///c:/Users/Glado/CartoonFactory/src/server/scheduler/types.ts))
Define los contratos de datos para la cola de trabajos, pasos atómicos (`JobStepDetail`), entradas de calendarización (`CreateCalendarItemInput`, `UpdateCalendarItemInput`) y métricas operativas del demonio (`SchedulerMetrics`).

### 3.2. Handlers de Tareas Asíncronas ([src/server/scheduler/job.handlers.ts](file:///c:/Users/Glado/CartoonFactory/src/server/scheduler/job.handlers.ts))
Implementación desacoplada para cada operación pesada del pipeline audiovisual:
* **`SCRIPTING`:** Invoca `geminiService.generateStory()`, emite telemetría de tokens y valida la estructura de la historia.
* **`VOICE_GENERATION`:** Itera sobre los diálogos de las escenas, genera pistas PCM WAV persistentes en `StorageProvider` y asocia duraciones exactas.
* **`ASSET_GENERATION`:** Produce fotogramas 16:9 con resolución adaptativa (1080p en producción, miniatura liviana en testing) con trazabilidad SHA-256.
* **`FFMPEG_RENDER`:** Delega en `RenderService` la composición no bloqueante de video, audio y subtítulos incrustados.
* **`VALIDATION`:** Evalúa drift numérico $\le 0.05$s y políticas COPPA FTC 16 CFR Part 312.
* **`YOUTUBE_PUBLISH`:** Ejecuta el protocolo de subida reanudable en YouTube Data API v3 con clasificación `selfDeclaredMadeForKids: true`.

### 3.3. Motor de Cola de Trabajadores ([src/server/scheduler/worker.queue.ts](file:///c:/Users/Glado/CartoonFactory/src/server/scheduler/worker.queue.ts))
* **Manejo de Concurrencia:** Cola con semáforo que limita el número de tareas concurrentes simultáneas (`maxConcurrency`).
* **Inmutabilidad y Pasos Atómicos:** Registro detallado de subtareas en la tabla `job_steps` utilizando la restricción única `uq_job_step_index`.
* **Cancelación Asíncrona:** Interrupción limpia mediante `AbortSignal` y protección RAII de temporizadores.
* **Tolerancia a Fallos y Reintentos:** Política de hasta $N$ reintentos automáticos ante excepciones transitorias antes de marcar la tarea como `FAILED`.

### 3.4. Planificador de Calendario Editorial ([src/server/scheduler/editorial.scheduler.ts](file:///c:/Users/Glado/CartoonFactory/src/server/scheduler/editorial.scheduler.ts))
* **Detección Determinista:** Búsqueda en PostgreSQL de elementos con `editorialStatus = 'CONFIRMED'` y `plannedAt <= NOW()`.
* **Gatekeeper Inmutable:** Comprobación obligatoria del informe de Control de Calidad (`qcService.getLatestReport`). Si el episodio presenta desincronización de audio ($>0.05$s) o infracción de privacidad infantil, la emisión se aborta y se registra el motivo de bloqueo.
* **Transición de Estado:** Al culminar la subida, actualiza el estado a `BROADCASTED`, asocia la clave foránea `youtubePublicationId` y añade la URL del vídeo en notas.

### 3.5. Coordinador y Router REST ([src/server/scheduler/scheduler.service.ts](file:///c:/Users/Glado/CartoonFactory/src/server/scheduler/scheduler.service.ts) y [src/server/scheduler/scheduler.router.ts](file:///c:/Users/Glado/CartoonFactory/src/server/scheduler/scheduler.router.ts))
Endpoints expuestos bajo `/api/scheduler/*`:
* `GET /api/scheduler/status`: Salud del demonio, trabajos activos, cola y métricas de calendario.
* `POST /api/scheduler/start` y `/stop`: Control del bucle periódico en background.
* `POST /api/scheduler/trigger`: Disparo forzado e inmediato de la ronda de revisión.
* `POST /api/scheduler/jobs/dispatch`: Encolado asíncrono con semántica HTTP `202 Accepted` y retorno de URLs de sondeo y Server-Sent Events.
* `GET /api/scheduler/jobs` y `GET /api/scheduler/jobs/:jobId`: Consulta de estado y pasos atómicos.
* `POST /api/scheduler/jobs/:jobId/cancel` y `/retry`: Control administrativo de tareas.
* `GET|POST /api/scheduler/calendar`, `PATCH|DELETE /api/scheduler/calendar/:id`: Gestión completa del calendario editorial.

---

## 4. Verificación y Resultados de Pruebas

Se ejecutó la suite completa de pruebas unitarias y de integración mediante Vitest:

```bash
npx vitest run
```

### Resumen de Suites:
1. `src/server/auth/auth.security.spec.ts` (34 tests) — Pass
2. `src/server/ai/ai.security.spec.ts` (31 tests) — Pass
3. `src/server/storage/storage.spec.ts` (40 tests) — Pass
4. `src/server/audio/audio.spec.ts` (28 tests) — Pass
5. `src/server/visuals/visual.spec.ts` (21 tests) — Pass
6. `src/server/render/render.spec.ts` (16 tests) — Pass
7. `src/server/qc/qc.spec.ts` (26 tests) — Pass
8. `src/server/youtube/youtube.spec.ts` (29 tests) — Pass
9. `src/server/scheduler/scheduler.spec.ts` (27 tests) — Pass

**Total: 252 tests pasando al 100% (0 fallos, 0 regresiones).**

### Verificación de Compilación y Bundles:
```bash
npm run build
```
* Compilación limpia de Angular 21 y bundles SSR de Node.js (`server.mjs`).
