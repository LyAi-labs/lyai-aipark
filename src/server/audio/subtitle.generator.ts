/**
 * Cartoon Studio — Subtitle & Dialogue Alignment Engine
 * Phase 06: Real Voice & Audio Pipeline
 *
 * Implements deterministic timestamp formatting, SubRip (SRT) and WebVTT (VTT)
 * track generation from calculated audio durations, and drift telemetry against nominal scene lengths.
 */

export interface SubtitleCue {
  index: number;
  startSeconds: number;
  endSeconds: number;
  speaker?: string;
  text: string;
}

export interface AlignedSceneAudio {
  sceneIndex: number;
  sceneCode: string;
  nominalDurationSeconds: number;
  audioDurationSeconds: number;
  driftSeconds: number; // audioDuration - nominalDuration
  startTimelineSeconds: number;
  endTimelineSeconds: number;
  speaker?: string;
  text: string;
}

/**
 * Formats seconds into SRT timestamp format: HH:MM:SS,mmm
 */
export function formatSrtTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const totalMs = Math.round(safe * 1000);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const milliseconds = totalMs % 1000;

  const hh = hours.toString().padStart(2, '0');
  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');
  const mmm = milliseconds.toString().padStart(3, '0');

  return `${hh}:${mm}:${ss},${mmm}`;
}

/**
 * Formats seconds into WebVTT timestamp format: HH:MM:SS.mmm
 */
export function formatVttTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const totalMs = Math.round(safe * 1000);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const milliseconds = totalMs % 1000;

  const hh = hours.toString().padStart(2, '0');
  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');
  const mmm = milliseconds.toString().padStart(3, '0');

  return `${hh}:${mm}:${ss}.${mmm}`;
}

/**
 * Builds standard SubRip (.srt) subtitle track.
 */
export function buildSrtTrack(cues: SubtitleCue[]): string {
  const blocks: string[] = [];

  for (const cue of cues) {
    const startStr = formatSrtTimestamp(cue.startSeconds);
    const endStr = formatSrtTimestamp(cue.endSeconds);
    const speakerPrefix = cue.speaker ? `[${cue.speaker}]: ` : '';
    const cleanText = cue.text.trim();

    blocks.push(`${cue.index}\n${startStr} --> ${endStr}\n${speakerPrefix}${cleanText}`);
  }

  return blocks.join('\n\n') + (blocks.length > 0 ? '\n' : '');
}

/**
 * Builds standard WebVTT (.vtt) subtitle track with voice cues.
 */
export function buildVttTrack(cues: SubtitleCue[], title = 'Cartoon Studio Aligned Track'): string {
  const lines: string[] = ['WEBVTT', `NOTE ${title}`, ''];

  for (const cue of cues) {
    const startStr = formatVttTimestamp(cue.startSeconds);
    const endStr = formatVttTimestamp(cue.endSeconds);
    const cleanText = cue.text.trim();
    const speakerTag = cue.speaker ? `<v ${cue.speaker}>${cleanText}</v>` : cleanText;

    lines.push(
      `${cue.index}`,
      `${startStr} --> ${endStr}`,
      speakerTag,
      ''
    );
  }

  return lines.join('\n');
}

/**
 * Computes an aligned timeline given scenes with measured audio durations.
 */
export function computeAlignedTimeline(
  scenes: Array<{
    sceneIndex: number;
    sceneCode: string;
    nominalDuration: number;
    audioDuration: number;
    speaker?: string;
    text: string;
  }>
): {
  alignedScenes: AlignedSceneAudio[];
  cues: SubtitleCue[];
  totalEpisodeDurationSeconds: number;
  totalAudioDurationSeconds: number;
  maxDriftSeconds: number;
} {
  const alignedScenes: AlignedSceneAudio[] = [];
  const cues: SubtitleCue[] = [];

  let currentTimeline = 0;
  let totalAudio = 0;
  let maxDrift = 0;

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const audioDur = s.audioDuration;
    const nominalDur = s.nominalDuration;
    // Each scene lasts at least as long as its audio plus a 0.5s pause/breath margin,
    // or its nominal duration, whichever is greater
    const sceneSpan = Math.max(nominalDur, audioDur + 0.5);
    const drift = Number((audioDur - nominalDur).toFixed(3));

    if (Math.abs(drift) > maxDrift) {
      maxDrift = Math.abs(drift);
    }

    const start = currentTimeline;
    const end = Number((start + audioDur).toFixed(3));

    alignedScenes.push({
      sceneIndex: s.sceneIndex,
      sceneCode: s.sceneCode,
      nominalDurationSeconds: nominalDur,
      audioDurationSeconds: audioDur,
      driftSeconds: drift,
      startTimelineSeconds: start,
      endTimelineSeconds: end,
      speaker: s.speaker,
      text: s.text,
    });

    if (s.text && s.text.trim().length > 0) {
      cues.push({
        index: cues.length + 1,
        startSeconds: start,
        endSeconds: end,
        speaker: s.speaker,
        text: s.text,
      });
    }

    currentTimeline = Number((currentTimeline + sceneSpan).toFixed(3));
    totalAudio = Number((totalAudio + audioDur).toFixed(3));
  }

  return {
    alignedScenes,
    cues,
    totalEpisodeDurationSeconds: currentTimeline,
    totalAudioDurationSeconds: totalAudio,
    maxDriftSeconds: maxDrift,
  };
}
