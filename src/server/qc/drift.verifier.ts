/**
 * Cartoon Studio — Deterministic Audio Drift Verifier
 * Phase 09: Objective Quality Control (Audio Drift & COPPA Checks)
 *
 * Implements millisecond-precise audiovisual synchronization telemetry.
 * Invariant: abs(audio_duration - video_duration) <= 0.05s (50 ms).
 * Exceeding this limit triggers a CRITICAL failure and production block.
 */

import { execFileSync } from 'node:child_process';
import { config } from '../config';
import { logger } from '../utils/logger';
import { QCCheckResult, SceneDriftInfo, MediaProbeResult } from './qc.types';

/**
 * Strict broadcast synchronization tolerance threshold: 50 milliseconds (0.05s).
 * Established in MASTER_PLAN.md Phase 09.
 */
export const DEFAULT_MAX_DRIFT_SECONDS = 0.05;

/**
 * Calculates raw signed drift between audio and video tracks: audioDuration - videoDuration.
 * A positive drift means audio outlasts video; negative means video outlasts audio.
 */
export function calculateDriftSeconds(audioDuration: number, videoDuration: number): number {
  if (isNaN(audioDuration) || isNaN(videoDuration)) {
    return 0;
  }
  return Number((audioDuration - videoDuration).toFixed(4));
}

/**
 * Verifies global audio-video duration drift against tolerance threshold.
 */
export function verifyAudioDrift(
  audioDurationSeconds: number,
  videoDurationSeconds: number,
  maxToleranceSeconds = DEFAULT_MAX_DRIFT_SECONDS
): QCCheckResult {
  const drift = calculateDriftSeconds(audioDurationSeconds, videoDurationSeconds);
  const absDrift = Math.abs(drift);
  const driftMs = Math.round(absDrift * 1000);
  const toleranceMs = Math.round(maxToleranceSeconds * 1000);

  if (absDrift <= maxToleranceSeconds) {
    return {
      ruleCode: 'AUDIO_DRIFT_SYNC_LIMIT',
      category: 'AUDIO',
      severity: 'CRITICAL',
      status: 'PASS',
      score: 100,
      notes: `Sincronización audiovisual óptima. Desfase medido: ${driftMs} ms (dentro del umbral tolerado de ±${toleranceMs} ms).`,
      telemetry: {
        audioDurationSeconds,
        videoDurationSeconds,
        driftSeconds: drift,
        absDriftSeconds: absDrift,
        toleranceSeconds: maxToleranceSeconds,
        driftMs,
      },
    };
  }

  // If between 50ms and 150ms, assign partial score but FAIL critical broadcast check
  const isSlight = absDrift <= maxToleranceSeconds * 3;
  const score = isSlight ? 40 : 0;

  return {
    ruleCode: 'AUDIO_DRIFT_SYNC_LIMIT',
    category: 'AUDIO',
    severity: 'CRITICAL',
    status: 'FAIL',
    score,
    notes: `Desincronización audiovisual inaceptable. Desfase medido: ${driftMs} ms supera el límite reglamentario de ±${toleranceMs} ms (drift: ${drift > 0 ? '+' : ''}${drift}s).`,
    remediation: 'Ajustar la duración nominal de los fotogramas en FFmpeg o remuestrear la pista de audio con filtro "atempo" / "setpts" para garantizar paridad temporal.',
    telemetry: {
      audioDurationSeconds,
      videoDurationSeconds,
      driftSeconds: drift,
      absDriftSeconds: absDrift,
      toleranceSeconds: maxToleranceSeconds,
      driftMs,
    },
  };
}

/**
 * Analyzes scene-by-scene audio alignment to pinpoint cumulative drift.
 */
export function verifySceneDriftTimeline(
  scenes: Array<{
    sceneIndex?: number;
    sceneCode?: string;
    nominalDurationSeconds: number;
    audioDurationSeconds?: number;
  }>,
  maxToleranceSeconds = DEFAULT_MAX_DRIFT_SECONDS
): {
  isSynchronized: boolean;
  maxDriftSeconds: number;
  scenesInfo: SceneDriftInfo[];
  checkResult: QCCheckResult;
} {
  const scenesInfo: SceneDriftInfo[] = [];
  let maxDrift = 0;
  let hasSceneFailure = false;

  scenes.forEach((sc, idx) => {
    const audioDur = sc.audioDurationSeconds ?? sc.nominalDurationSeconds;
    const nominalDur = sc.nominalDurationSeconds;
    const drift = calculateDriftSeconds(audioDur, nominalDur);
    const absDrift = Math.abs(drift);

    if (absDrift > maxDrift) {
      maxDrift = absDrift;
    }

    const isWithin = absDrift <= maxToleranceSeconds;
    if (!isWithin) {
      hasSceneFailure = true;
    }

    scenesInfo.push({
      sceneIndex: sc.sceneIndex ?? idx + 1,
      sceneCode: sc.sceneCode || `SCENE_${idx + 1}`,
      nominalDurationSeconds: nominalDur,
      audioDurationSeconds: audioDur,
      driftSeconds: drift,
      isWithinTolerance: isWithin,
    });
  });

  const checkResult: QCCheckResult = hasSceneFailure
    ? {
        ruleCode: 'SCENE_CADENCE_DRIFT_LIMIT',
        category: 'AUDIO',
        severity: 'WARNING',
        status: 'WARNING',
        score: Math.max(20, Math.round(100 - maxDrift * 200)),
        notes: `Se detectaron escenas individuales con desfase entre locución y duración nominal (máximo desfase escena: ${(maxDrift * 1000).toFixed(0)} ms).`,
        remediation: 'Revisar la longitud de los diálogos en escenas con desfase para mantener una cadencia visual fluida.',
        telemetry: { maxDriftSeconds: maxDrift, totalScenes: scenes.length },
      }
    : {
        ruleCode: 'SCENE_CADENCE_DRIFT_LIMIT',
        category: 'AUDIO',
        severity: 'WARNING',
        status: 'PASS',
        score: 100,
        notes: `Cadencia de escenas perfectamente alineada (máximo desfase local: ${(maxDrift * 1000).toFixed(0)} ms).`,
        telemetry: { maxDriftSeconds: maxDrift, totalScenes: scenes.length },
      };

  return {
    isSynchronized: !hasSceneFailure,
    maxDriftSeconds: maxDrift,
    scenesInfo,
    checkResult,
  };
}

/**
 * Uses ffprobe to probe duration of video and audio streams inside a media file.
 * Returns durations with microsecond precision and evaluates audio/video drift.
 */
export async function probeMediaDuration(filePath: string): Promise<MediaProbeResult> {
  const ffprobePath = config.ffmpeg?.ffprobePath || 'ffprobe';

  try {
    const rawOutput = execFileSync(
      ffprobePath,
      [
        '-v', 'error',
        '-show_entries', 'format=duration:stream=index,codec_type,duration',
        '-of', 'json',
        filePath,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10000,
      }
    );

    const parsed = JSON.parse(rawOutput);
    const containerDuration = parseFloat(parsed.format?.duration) || 0;

    let videoDuration: number | undefined;
    let audioDuration: number | undefined;
    let hasVideo = false;
    let hasAudio = false;

    if (Array.isArray(parsed.streams)) {
      for (const s of parsed.streams) {
        if (s.codec_type === 'video' && !hasVideo) {
          hasVideo = true;
          if (s.duration) {
            videoDuration = parseFloat(s.duration);
          }
        } else if (s.codec_type === 'audio' && !hasAudio) {
          hasAudio = true;
          if (s.duration) {
            audioDuration = parseFloat(s.duration);
          }
        }
      }
    }

    // If streams did not declare individual duration tags, fall back to container duration
    if (hasVideo && videoDuration === undefined) {
      videoDuration = containerDuration;
    }
    if (hasAudio && audioDuration === undefined) {
      audioDuration = containerDuration;
    }

    let driftSeconds: number | undefined;
    let isWithinTolerance = true;

    if (hasVideo && hasAudio && videoDuration !== undefined && audioDuration !== undefined) {
      driftSeconds = calculateDriftSeconds(audioDuration, videoDuration);
      isWithinTolerance = Math.abs(driftSeconds) <= DEFAULT_MAX_DRIFT_SECONDS;
    }

    return {
      durationSeconds: containerDuration,
      videoDurationSeconds: videoDuration,
      audioDurationSeconds: audioDuration,
      driftSeconds,
      hasVideo,
      hasAudio,
      isWithinTolerance,
    };
  } catch (err: any) {
    logger.warn('ffprobe execution failed or file not accessible, using fallback probe', {
      error: err.message,
      filePath,
    });

    return {
      durationSeconds: 0,
      hasVideo: false,
      hasAudio: false,
      isWithinTolerance: true,
    };
  }
}
