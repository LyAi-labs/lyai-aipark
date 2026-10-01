# CARTOON FACTORY — PHASE 1A EXPERIMENT REPORT
## Proof of Loop: The Bouncing Hero

**Estado:** PASS  
**Fecha:** 2026-10-01  
**Ejecutor:** Antigravity AI Systems Architect  
**Repositorio:** [C:\Users\Glado\CartoonFactory](file:///C:/Users/Glado/CartoonFactory)  
**Módulo Experimental:** [experiments/phase-1a-proof-of-loop](file:///C:/Users/Glado/CartoonFactory/experiments/phase-1a-proof-of-loop)  

---

### 1. Objetivo

Demostrar de forma real, física y empírica la primera célula funcional del sistema de producción de Cartoon Factory:
Un ciclo autónomo de control y verificación capaz de:
1. Recibir una especificación audiovisual inmutable.
2. Construir un artefacto multimedia real en disco.
3. Someter el artefacto a un control de calidad objetivo e independiente (Hard QA).
4. Detectar un fallo deliberado.
5. Permitir que el agente observe la evidencia, diagnostique la causa raíz y formule una acción correctora.
6. Aplicar la corrección mediante herramientas reales sin alterar el contrato.
7. Reconstruir el artefacto y verificar mediante QA independiente que ahora cumple el contrato con veredicto PASS.

---

### 2. Arquitectura

El sistema implementa una separación estricta de 5 responsabilidades desacopladas:

```text
       ┌────────────────┐
       │   AGENT (AI)   │ <── Observa hechos objetivos, diagnostica causa raíz y decide
       └───────┬────────┘
               │ Invoca acciones concretas
               ▼
       ┌────────────────┐
       │  TOOLS/RENDER  │ <── Genera activos, renderiza/muxea vía FFmpeg, adapta streams
       └───────┬────────┘
               │ Produce artefacto físico
               ▼
       ┌────────────────┐
       │ HARD QA (ffprobe)│ <── Mide streams, calcula drift, emite facts y PASS/FAIL
       └───────┬────────┘
               │ Emite veredicto
               ▼
       ┌────────────────┐
       │ STATE & LOGS   │ <── Persistencia JSON y bitácora atómica append-only JSONL
       └────────────────┘
```

- **AGENT:** El modelo de razonamiento real (sin scripts deterministas simulando un agente falso).
- **TOOLS:** [generate_assets.py](file:///C:/Users/Glado/CartoonFactory/experiments/phase-1a-proof-of-loop/tools/generate_assets.py), [render.py](file:///C:/Users/Glado/CartoonFactory/experiments/phase-1a-proof-of-loop/tools/render.py), [patch_audio.py](file:///C:/Users/Glado/CartoonFactory/experiments/phase-1a-proof-of-loop/tools/patch_audio.py).
- **QA:** [qa.py](file:///C:/Users/Glado/CartoonFactory/experiments/phase-1a-proof-of-loop/tools/qa.py), ejecutando `ffprobe` sobre el artefacto real.
- **STATE:** [state/pipeline.state.json](file:///C:/Users/Glado/CartoonFactory/experiments/phase-1a-proof-of-loop/state/pipeline.state.json).
- **LOGS:** [logs/events.jsonl](file:///C:/Users/Glado/CartoonFactory/experiments/phase-1a-proof-of-loop/logs/events.jsonl).

---

### 3. Contrato Inmutable

Definido en [spec.json](file:///C:/Users/Glado/CartoonFactory/experiments/phase-1a-proof-of-loop/spec.json):

```json
{
  "title": "Proof of Loop: The Bouncing Hero",
  "fps": 30,
  "totalFrames": 90,
  "durationSeconds": 3.0,
  "resolution": {
    "width": 1280,
    "height": 720
  },
  "videoCodec": "h264",
  "audioCodec": "aac",
  "tolerances": {
    "maxDriftFrames": 1,
    "maxDriftSeconds": 0.033
  }
}
```

- **Protección de inmutabilidad:**
  - Atributo de sólo lectura a nivel de sistema operativo (`attrib +r`).
  - Hash SHA-256 verificado en cada llamada de herramienta: `b228c4f76dc4abfd03116f8fe0b4433bf8b7888dfdd7de1131ec79b5f2a41c81`. Cualquier modificación no autorizada aborta la ejecución con error crítico.

---

### 4. Fallo Introducido (Attempt 1)

Se generaron intencionalmente:
- Activo de vídeo: `3.00s`, 90 frames, 30 fps, 1280x720, códec H.264.
- Activo de audio inicial: `4.20s` (desajuste deliberado de +1.20s frente a contrato).
- Artefacto renderizado: [renders/v1_fail.mp4](file:///C:/Users/Glado/CartoonFactory/experiments/phase-1a-proof-of-loop/renders/v1_fail.mp4) (93,805 bytes).

---

### 5. Evaluación de QA Objetivo (Attempt 1)

El script de QA independiente [qa.py](file:///C:/Users/Glado/CartoonFactory/experiments/phase-1a-proof-of-loop/tools/qa.py) inspeccionó el contenedor y los streams mediante `ffprobe`:

- **Resultado:** `FAIL` (Exit code: 1).
- **Failed Checks:** `["AUDIO_DURATION_MISMATCH", "AV_DRIFT_EXCEEDS_TOLERANCE"]`.
- **Facts medidos:**
  - `videoDurationSeconds`: 3.0000s (90 frames exactos @ 30.0 fps).
  - `audioDurationSeconds`: 4.2240s.
  - `driftSeconds`: 1.2240s.
  - `driftFrames`: 36.72 frames.
  - `maxAllowedDriftSeconds`: 0.0330s (1.0 frame).
- Reporte preservado en: [reports/qa_report_attempt_1.json](file:///C:/Users/Glado/CartoonFactory/experiments/phase-1a-proof-of-loop/reports/qa_report_attempt_1.json).

---

### 6. Diagnóstico del Agente

Tras la emisión del veredicto FAIL de QA, el flujo se detuvo y transfirió la evidencia al Agente Antigravity:

- **Observación del Agente:** El artefacto [v1_fail.mp4](file:///C:/Users/Glado/CartoonFactory/experiments/phase-1a-proof-of-loop/renders/v1_fail.mp4) viola las comprobaciones de duración de audio y drift audiovisual. El vídeo cumple estrictamente la especificación (1280x720, 30fps, 90 frames, 3.0s), mientras que el audio tiene una duración medida de 4.224s.
- **Diagnóstico del Agente:** La causa raíz es el activo de audio crudo (`audio_raw_4.2s.aac`), cuya duración excede en ~1.224s el límite contractual. La pista visual es válida.
- **Propuesta de Acción:** Invocar la herramienta [patch_audio.py](file:///C:/Users/Glado/CartoonFactory/experiments/phase-1a-proof-of-loop/tools/patch_audio.py) para recortar/adaptar el audio al contrato inmutable de 3.00s, generando `assets/audio_adapted_3.0s.aac` y re-ejecutar el renderizador sin modificar `spec.json`.

---

### 7. Patch

El Agente invocó la herramienta:
```bash
python tools/patch_audio.py --input assets/audio_raw_4.2s.aac --target-duration 3.0 --output assets/audio_adapted_3.0s.aac
```
- Resultado: Creación física de `assets/audio_adapted_3.0s.aac` (47,954 bytes).
- Sin alteraciones en `spec.json`.

---

### 8. Segundo Render (Attempt 2)

Se invocó el renderizador con los activos corregidos:
```bash
python tools/render.py --video-input assets/hero_video_3s.mp4 --audio-input assets/audio_adapted_3.0s.aac --output renders/v2_pass.mp4 --stage PHASE_7_RE_RENDER
```
- Resultado: Creación física de [renders/v2_pass.mp4](file:///C:/Users/Glado/CartoonFactory/experiments/phase-1a-proof-of-loop/renders/v2_pass.mp4) (74,142 bytes).
- La evidencia de `v1_fail.mp4` se preservó intacta.

---

### 9. Resultado Final de Hard QA (Attempt 2)

Hard QA re-evaluó de manera autónoma [v2_pass.mp4](file:///C:/Users/Glado/CartoonFactory/experiments/phase-1a-proof-of-loop/renders/v2_pass.mp4):

- **Resultado:** `PASS` (Exit code: 0).
- **Failed Checks:** `[]` (Ninguno).
- **Facts medidos:**
  - `fileSizeBytes`: 74,142 bytes.
  - `videoStreamExists`: True (h264, 1280x720, 30.0 fps, 90 frames).
  - `videoDurationSeconds`: 3.0000s.
  - `audioStreamExists`: True (aac, 48000 Hz, stereo).
  - `audioDurationSeconds`: 3.0290s.
  - `driftSeconds`: 0.0290s.
  - `driftFrames`: 0.87 frames.
  - `maxAllowedDriftSeconds`: 0.0330s (1.0 frame).
- Reporte preservado en: [reports/qa_report_attempt_2.json](file:///C:/Users/Glado/CartoonFactory/experiments/phase-1a-proof-of-loop/reports/qa_report_attempt_2.json).

---

### 10. Trazabilidad Completa

La secuencia exacta quedó registrada de forma inmutable en [logs/events.jsonl](file:///C:/Users/Glado/CartoonFactory/experiments/phase-1a-proof-of-loop/logs/events.jsonl):

1. `SYSTEM`: `EXPERIMENT_STARTED` (commit baseline `40929a6`).
2. `AGENT`: `BASELINE_PLANNED` (planificación de render v1 con fallo deliberado).
3. `TOOL`: `ASSETS_GENERATED` (vídeo 3.0s, audio 4.2s).
4. `AGENT`: `RENDER_V1_REQUESTED`.
5. `TOOL`: `RENDER_COMPLETED` (`renders/v1_fail.mp4`).
6. `QA`: `QA_FAIL` (Failed checks: audio mismatch, drift 1.224s).
7. `AGENT`: `AGENT_OBSERVATION` (Recepción y examen de hechos objetivos de QA).
8. `AGENT`: `AGENT_DIAGNOSIS` (Identificación de activo de audio como causa raíz).
9. `AGENT`: `AGENT_ACTION_PROPOSAL` (Propuesta de recorte a 3.0s vía patch_audio.py).
10. `TOOL`: `PATCH_AUDIO_COMPLETED` (`assets/audio_adapted_3.0s.aac`).
11. `AGENT`: `RE_RENDER_REQUESTED`.
12. `TOOL`: `RENDER_COMPLETED` (`renders/v2_pass.mp4`).
13. `QA`: `QA_PASS` (0 failed checks, drift 0.029s < 0.033s).
14. `AGENT`: `AGENT_OBSERVATION` (Confirmación de cumplimiento contractual).
15. `SYSTEM`: `EXPERIMENT_COMPLETED` (Cierre exitoso del loop en 2 intentos).

---

### 11. Desviaciones

- Ninguna desviación respecto al protocolo maestro aprobado.
- No se crearon módulos falsos (`agent.py` simulado).
- No se requirió intervención manual para ajustar parámetros o forzar el veredicto.

---

### 12. Limitaciones

- **Sintaxis de assets crudos:** La generación de assets utilizó filtros sintéticos deterministas de FFmpeg (`lavfi` con formas geométricas y tonos sinusoidales) en lugar de un motor gráfico complejo o modelos generativos.
- **Espacio de diagnóstico acotado:** La prueba se centró en un fallo de duración y desincronización audiovisual temporal. No abarca fallos perceptuales profundos (e.g. deformación de personajes, errores semánticos de guion o artefactos de colorimetría).

---

### 13. Qué Demuestra Realmente Phase 1A

1. **Separación efectiva de roles:** QA actúa como autoridad objetiva externa sin colusión con el generador.
2. **Razonamiento guiado por evidencia:** El agente no "adivina" ni asume; inspecciona métricas explícitas emitidas por una herramienta externa y formula una solución fundamentada en datos.
3. **Invariancia contractual:** El contrato permanece intacto y protegido; la adaptación se produce en los artefactos y el pipeline.
4. **Resiliencia y trazabilidad:** Toda mutación, decisión y resultado queda auditada en disco de manera determinista y persistente.

---

### 14. Qué NO Demuestra Todavía

- No demuestra capacidades de animación creativa avanzada o estilización artística.
- No demuestra integración con Remotion ni motores web-based de composición.
- No demuestra orquestación multi-agente ni generación probabilística de historias/assets.
- No demuestra resolución de fallos estéticos subjetivos (para los que se requerirán evaluadores multimodales en fases posteriores).
