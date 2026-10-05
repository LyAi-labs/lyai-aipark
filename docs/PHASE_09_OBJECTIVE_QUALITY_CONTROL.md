# PHASE 09 — OBJECTIVE QUALITY CONTROL (AUDIO DRIFT & COPPA CHECKS)
> **Estado:** COMPLETADA ✅  
> **Fecha:** 4 de Octubre de 2026  
> **Perfil Operativo:** Principal Research Software Engineer & AI Systems Architect  
> **Test Suite:** 196 tests globales pasando al 100% (26 tests específicos de Phase 09)

---

## 1. Resumen Ejecutivo de la Fase

La **Phase 09** dota a **Cartoon Studio** de un motor de Control de Calidad objetivo, determinista y matemáticamente riguroso, extirpando la dependencia de evaluaciones puramente heurísticas de LLMs para la validación crítica de emisión.

El subsistema implementa dos pilares inviolables (*hard invariants*):
1. **Verificación Numérica de Audio Drift (`drift.verifier.ts`):** Medición de desincronización temporal entre pistas de audio y vídeo con resolución de microsegundos y tolerancia estricta $\le 0.05\,\text{s}$ (50 ms). Superar este umbral activa un fallo `CRITICAL` inmediato y bloquea la publicación. Incorpora sonda de metadatos vía binario nativo **FFprobe** y análisis de cadencia escena a escena.
2. **Verificación Determinista de Normativas COPPA (`coppa.verifier.ts`):** Auditoría exhaustiva bajo la directiva legal **FTC COPPA Rule (16 CFR Part 312)** y las políticas de protección infantil de YouTube Kids. Bloquea de forma categórica cualquier extracción de datos personales identificables (PII: emails, teléfonos, domicilios, escuelas), prohíbe llamadas comerciales directas engañosas a menores, exige la clasificación obligatoria `madeForKids: true` y fuerza una postura inicial de privacidad `PRIVATE` para revisión humana obligatoria previa a la distribución pública.
3. **Servicio Orquestador de QC (`qc.service.ts`):** Centraliza la auditoría de episodios, calcula penalizaciones asimétricas ante infracciones críticas, genera informes detallados (`QCReportSummary`), persiste transaccionalmente en PostgreSQL (`QCReport` y `QCCheck`) con fallback en memoria resiliente, y aplica el bloqueo del proyecto (`isBlocked = true`, `status = 'BLOCKED'`).
4. **Gatekeeper de Publicación en API (`server.ts`):** El endpoint `POST /api/youtube/publish` intercepta las solicitudes de emisión; si el episodio presenta drift desincronizado o una infracción COPPA no subsanada, **aborta la publicación** con código HTTP **422 Unprocessable Entity (`QC_VALIDATION_FAILED`)**.
5. **Panel Interactivo de QC en Frontend (`QcView` & `Studio`):** Despliega telemetría de drift en milisegundos con barra de tolerancia visual, tarjetas de certificación COPPA y banner de remediación de bloqueo que desactiva reactivamente el botón de avance a YouTube si no se cumplen los estándares.

---

## 2. Topología de Componentes & Flujo de Auditoría

```
                       [CLIENTE / FRONTEND ANGULAR 21]
                       ├── Studio.activeProject()
                       └── QcView (Telemetría de Drift & COPPA HUD)
                                   │
                    1. POST /api/qc/audit (JWT Auth)
                                   ▼
                       [EXPRESS API (src/server.ts)]
                                   │
                                   ▼
                    [QualityControlService (Orquestador)]
                    ├── 1. drift.verifier.ts (Audio Drift <= 0.05s)
                    │      ├── probeMediaDuration() [FFprobe Process]
                    │      └── verifySceneDriftTimeline()
                    ├── 2. coppa.verifier.ts (FTC 16 CFR Part 312)
                    │      ├── Scanner PII (emails, phones, locations)
                    │      ├── Anti-Commercial Exploitation (CTAs)
                    │      └── Enforced madeForKids & Private Status
                    ├── 3. Subtitle Readability & Technical Standards
                    └── 4. Evaluador de Bloqueo Invariante
                                   │
               ┌───────────────────┴───────────────────┐
       ¿Fallo Crítico?                         Sin Fallos Críticos
               │                                       │
               ▼ (SÍ)                                  ▼ (NO)
    isBlocked = true                       approvedForProduction = true
    approvedForProduction = false          overallScore >= 90
    overallScore < 50                      isBlocked = false
               │                                       │
               └───────────────────┬───────────────────┘
                                   ▼
                 [Persistencia Transaccional PostgreSQL 16]
                 ├── qc_reports (overall_score, approved_for_production)
                 └── qc_checks (rule_code, severity, status, notes)
                                   │
                                   ▼
                [Gatekeeper en POST /api/youtube/publish]
                ├── Si isBlocked == true ──► 422 QC_VALIDATION_FAILED (Aborta)
                └── Si aprobado          ──► 200 OK (Autoriza subida privada)
```

---

## 3. Especificación de Reglas y Códigos de Control

| Código de Regla (`ruleCode`) | Categoría (`QCCategory`) | Severidad | Criterio de Aprobación | Acción ante Infracción |
| :--- | :--- | :---: | :--- | :--- |
| `AUDIO_DRIFT_SYNC_LIMIT` | `AUDIO` | **CRITICAL** | $\| \text{audioDuration} - \text{videoDuration} \| \le 0.05\,\text{s}$ (50 ms). | **FAIL (Score 0). Bloquea publicación.** Remediación: ajustar fotogramas o filtro atempo. |
| `SCENE_CADENCE_DRIFT_LIMIT` | `AUDIO` | `WARNING` | Drift por escena $\le 0.05\,\text{s}$. | `WARNING`. Sugerencia de balance de longitud de diálogo. |
| `COPPA_MADE_FOR_KIDS_CLASSIFICATION` | `SAFETY_COMPLIANCE` | **CRITICAL** | `madeForKids: true` y declaración confirmada. | **FAIL (Score 0). Bloquea producción.** Obliga a reclasificar la audiencia. |
| `COPPA_PRIVATE_PUBLISH_DEFAULT` | `SAFETY_COMPLIANCE` | **CRITICAL** | Visibilidad inicial `PRIVATE` o `UNLISTED`. | **FAIL (Score 0). Bloquea publicación directa.** Prohíbe salida pública no auditada. |
| `COPPA_PII_DATA_COLLECTION` | `SAFETY_COMPLIANCE` | **CRITICAL** | Cero correos, teléfonos o peticiones de datos personales. | **FAIL (Score 0). Bloquea producción.** Elimina de inmediato solicitudes privadas. |
| `COPPA_CHILD_SAFETY_CONTENT` | `SAFETY_COMPLIANCE` | **CRITICAL** | Cero violencia física, armas, fuego o conductas de alto riesgo. | **FAIL (Score 0). Bloquea producción.** Obliga a reescribir escenas. |
| `COPPA_COMMERCIAL_EXPLOITATION` | `SAFETY_COMPLIANCE` | **CRITICAL** | Cero incitaciones directas de compra o transacciones a menores. | **FAIL (Score 0). Bloquea producción.** Elimina CTAs agresivas. |
| `COPPA_INTERACTION_RESTRICTIONS` | `CONTENT` | `WARNING` | Sin peticiones de comentarios ni campanas de YouTube Kids. | `WARNING`. Recomienda cambiar llamada por pregunta reflexiva. |
| `SUBTITLE_CHILD_READABILITY` | `CONTENT` | `WARNING` | Máximo 7-10 palabras por subtítulo para lectura preescolar. | `WARNING`. Sugiere fragmentar diálogos extensos. |
| `TECHNICAL_FORMAT_STANDARDS` | `TECHNICAL` | `WARNING` | Contenedor MP4 con H.264 High Profile y audio AAC 44.1kHz. | Conforme por diseño del renderizador nativo FFmpeg. |

---

## 4. Matriz de Endpoints REST Implementados

| Método | Endpoint | Autenticación | Payload / Parámetros | Código HTTP | Respuesta Principal |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `POST` | `/api/qc/audit` | `requireAuth` | `AuditEpisodeInputSchema` | 200 OK | `{ success: true, report: QCReportSummary }` |
| `POST` | `/api/qc/check-drift` | `requireAuth` | `CheckDriftInputSchema` | 200 OK | `{ success: true, check: QCCheckResult, isSynchronized: boolean }` |
| `POST` | `/api/qc/check-coppa` | `requireAuth` | `CheckCoppaInputSchema` | 200 OK | `{ success: true, isCompliant: boolean, checks: QCCheckResult[] }` |
| `GET` | `/api/qc/reports/:episodeId` | `requireAuth` | `:episodeId` en URL | 200 OK / 404 | `{ success: true, report: QCReportSummary }` |
| `POST` | `/api/qc/approve/:episodeId` | `requireAuth` | `:episodeId` en URL, `notes` | 200 OK / 400 | `{ success: true, message: "...", report }` (400 si está bloqueado) |
| `POST` | `/api/youtube/publish` | `requireAuth` | `projectId`, `privacyStatus`, etc. | 200 OK / **422** | **422 QC_VALIDATION_FAILED** si el episodio tiene bloqueos de QC activos. |

---

## 5. Verificación Empírica y Suite de Pruebas

Se ejecutó la suite de pruebas completa del proyecto con **Vitest**:

```
 Test Files  7 passed (7)
      Tests  196 passed (196)
   Duration  12.00s
```

### Cobertura de Phase 09 (`src/server/qc/qc.spec.ts` — 26/26 tests pasando en 241 ms):
1. **Invariantes Matemáticos de Drift:** Cálculo firmado con 4 decimales; aprobación a 0 ms, 40 ms, 50 ms exactos; fallo a 51 ms (+1 ms sobre tolerancia) con severidad `CRITICAL`.
2. **Cadencia Escena a Escena:** Sincronización continua de línea temporal y detección de escenas individuales desfasadas.
3. **Sonda FFprobe:** Captura de streams y duraciones de contenedores multimedia con tolerancia a archivos inaccesibles.
4. **Seguridad COPPA & FTC 16 CFR Part 312:**
   - Aprobación de guiones educativos infantiles libres de riesgos.
   - Rechazo crítico ante `madeForKids: false`.
   - Rechazo crítico ante visibilidad inicial `public`.
   - Detección léxica y regex de emails (`info@escuela.com`) y teléfonos (+34...).
   - Detección de patrones de solicitud de datos infantiles (domicilio, colegio, nombre completo).
   - Bloqueo de armas, fuego, sustancias peligrosas e insultos.
   - Bloqueo de explotación comercial agresiva dirigida a menores.
   - Advertencias pedagógicas sobre comentarios en YouTube Kids.
5. **Orquestación de QualityControlService:** Aprobación con score $\ge 90$ para episodios limpios; asignación de `isBlocked = true` ante drift o COPPA; validación de gatekeeper `assertPublicationAllowed`.
6. **Endpoints REST de Quality Control:** Invocación HTTP nativa (`fakeHttpRequest`) sin dependencias externas pesadas validando esquemas Zod en `/check-drift`, `/check-coppa`, `/audit`, `/reports/:id` y `/approve/:id`.
7. **Gatekeeper Invariante de YouTube:** Comprobación empírica de rechazo con código HTTP 422 ante intento de publicación de vídeos no aptos.
