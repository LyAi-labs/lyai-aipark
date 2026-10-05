/**
 * Cartoon Studio — FFmpeg Process Wrapper & Video Compositor
 * Phase 08: Real Video Rendering Engine (FFmpeg Worker)
 *
 * Implements mechanical, transparent execution of native FFmpeg child processes
 * via child_process.spawn. Provides scene clip rendering, audio-video multiplexing,
 * lossless concat demuxing, and granular progress telemetry.
 * Zero external wrappers. Direct OS-level control.
 */

import { spawn, execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config';
import { logger } from '../utils/logger';
import { MotionEffect } from './render.types';

export interface FfmpegCapabilities {
  available: boolean;
  version: string;
  ffmpegPath: string;
  ffprobePath: string;
}

export interface SceneClipRenderOptions {
  imagePath: string;
  audioPath?: string;
  outputPath: string;
  duration: number; // in seconds
  motionType?: MotionEffect;
  width?: number; // default 1920
  height?: number; // default 1080
  fps?: number; // default 24
  abortSignal?: AbortSignal;
  onProgress?: (progressPercent: number) => void;
}

export interface MixAudioOptions {
  videoPath: string;
  musicPath: string;
  outputPath: string;
  musicVolume?: number; // default 0.15
  voiceVolume?: number; // default 1.0
  abortSignal?: AbortSignal;
  onProgress?: (progressPercent: number) => void;
}

/**
 * Checks system for FFmpeg and FFprobe binary availability and parses version.
 */
export function checkFfmpegAvailability(): FfmpegCapabilities {
  const ffmpegPath = config.ffmpeg?.ffmpegPath || 'ffmpeg';
  const ffprobePath = config.ffmpeg?.ffprobePath || 'ffprobe';

  try {
    const output = execFileSync(ffmpegPath, ['-version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    const match = output.match(/ffmpeg version\s+([^\s]+)/i);
    const version = match ? match[1] : 'detected';

    return {
      available: true,
      version,
      ffmpegPath,
      ffprobePath,
    };
  } catch (error: any) {
    logger.warn('FFmpeg binary check failed', { error: error.message, ffmpegPath });
    return {
      available: false,
      version: 'none',
      ffmpegPath,
      ffprobePath,
    };
  }
}

/**
 * Parses time string (HH:MM:SS.xx) from FFmpeg stderr output and returns seconds.
 */
export function parseFfmpegTime(timeStr: string): number {
  const parts = timeStr.trim().split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  return 0;
}

/**
 * Spawns FFmpeg child process with arguments and captures stdout/stderr and progress.
 */
export function runFfmpegCommand(
  args: string[],
  options: {
    totalDurationSeconds?: number;
    abortSignal?: AbortSignal;
    onProgress?: (progressPercent: number) => void;
  } = {}
): Promise<void> {
  const ffmpegPath = config.ffmpeg?.ffmpegPath || 'ffmpeg';

  return new Promise((resolve, reject) => {
    let stderrBuffer = '';

    const proc = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    if (options.abortSignal) {
      if (options.abortSignal.aborted) {
        proc.kill('SIGKILL');
        return reject(new Error('FFmpeg operation was aborted before start'));
      }
      options.abortSignal.addEventListener('abort', () => {
        proc.kill('SIGKILL');
        reject(new Error('FFmpeg operation aborted by signal'));
      });
    }

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderrBuffer += text;

      // Extract time=HH:MM:SS.xx progress markers
      if (options.onProgress && options.totalDurationSeconds && options.totalDurationSeconds > 0) {
        const timeMatch = text.match(/time=(\d{2}:\d{2}:\d{2}\.\d+)/);
        if (timeMatch) {
          const currentSeconds = parseFfmpegTime(timeMatch[1]);
          const percent = Math.min(100, Math.round((currentSeconds / options.totalDurationSeconds) * 100));
          options.onProgress(percent);
        }
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg process: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        if (options.onProgress) {
          options.onProgress(100);
        }
        resolve();
      } else {
        const lastStderr = stderrBuffer.slice(-800);
        reject(new Error(`FFmpeg exited with non-zero code ${code}: ${lastStderr}`));
      }
    });
  });
}

/**
 * Generates an FFmpeg video filter for Ken Burns / camera motion and canvas resolution fitting.
 */
export function buildMotionFilter(
  motionType: MotionEffect = 'static',
  width = 1920,
  height = 1080,
  duration = 5,
  fps = 24
): string {
  // Base scale preserving aspect ratio + pad to exact resolution with black borders if needed
  const padFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;

  const totalFrames = Math.max(24, Math.ceil(duration * fps));

  switch (motionType) {
    case 'zoom-in': {
      // Zoom from 1.0 to 1.12 over scene duration
      return `zoompan=z='min(zoom+0.0012,1.12)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps},${padFilter}`;
    }
    case 'zoom-out': {
      // Zoom out smoothly
      return `zoompan=z='max(1.12-on*0.0012,1.0)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps},${padFilter}`;
    }
    case 'pan-left': {
      // Slight pan left
      return `zoompan=z=1.08:x='if(lte(on,-1),(iw-iw/zoom)/2,max(0,x-1.5))':y='(ih-ih/zoom)/2':d=${totalFrames}:s=${width}x${height}:fps=${fps},${padFilter}`;
    }
    case 'pan-right': {
      // Slight pan right
      return `zoompan=z=1.08:x='if(lte(on,-1),0,min((iw-iw/zoom),x+1.5))':y='(ih-ih/zoom)/2':d=${totalFrames}:s=${width}x${height}:fps=${fps},${padFilter}`;
    }
    case 'ken-burns': {
      // Subtle combined zoom and diagonal drift
      return `zoompan=z='min(zoom+0.0008,1.10)':d=${totalFrames}:x='x+0.5':y='y+0.3':s=${width}x${height}:fps=${fps},${padFilter}`;
    }
    case 'static':
    default:
      return padFilter;
  }
}

/**
 * Renders an individual scene clip combining image (PNG) + voice audio (WAV) into an MP4 segment.
 */
export async function renderSceneClip(options: SceneClipRenderOptions): Promise<void> {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const fps = options.fps ?? 24;
  const duration = Math.max(1, options.duration);

  // If motion is requested, zoompan requires larger virtual canvas or standard filter
  // For absolute speed and stability, we use padFilter with fallback
  const videoFilter = buildMotionFilter(options.motionType, width, height, duration, fps);

  const args: string[] = [
    '-y',
    '-loop', '1',
    '-framerate', `${fps}`,
    '-t', `${duration}`,
    '-i', options.imagePath,
  ];

  if (options.audioPath) {
    args.push('-i', options.audioPath);
  } else {
    // Generate silent audio track
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');
  }

  args.push(
    '-vf', videoFilter,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-r', `${fps}`,
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    '-t', `${duration}`,
    options.outputPath
  );

  await runFfmpegCommand(args, {
    totalDurationSeconds: duration,
    abortSignal: options.abortSignal,
    onProgress: options.onProgress,
  });
}

/**
 * Concatenates rendered scene MP4 segments into a unified timeline using FFmpeg concat demuxer.
 * Operates without video re-encoding (-c copy) for maximal speed and fidelity.
 */
export async function concatSceneClips(
  clipPaths: string[],
  outputConcatPath: string,
  tempDir: string,
  abortSignal?: AbortSignal
): Promise<void> {
  if (clipPaths.length === 0) {
    throw new Error('No clip paths provided for concatenation');
  }

  if (clipPaths.length === 1) {
    // Single clip — copy directly
    await fs.copyFile(clipPaths[0], outputConcatPath);
    return;
  }

  // Create concat manifest file with safe POSIX-formatted paths
  const manifestPath = join(tempDir, 'concat_manifest.txt');
  const manifestContent = clipPaths
    .map((p) => `file '${p.replace(/\\/g, '/')}'`)
    .join('\n');

  await fs.writeFile(manifestPath, manifestContent, 'utf8');

  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', manifestPath,
    '-c', 'copy',
    outputConcatPath,
  ];

  await runFfmpegCommand(args, { abortSignal });
}

/**
 * Mixes background music and episode voice audio, applying configured volume levels.
 */
export async function mixAudioTracks(options: MixAudioOptions): Promise<void> {
  const musicVol = options.musicVolume ?? 0.15;
  const voiceVol = options.voiceVolume ?? 1.0;

  // Use FFmpeg filter_complex amix with volume adjustment
  const filter = `[0:a]volume=${voiceVol}[v_aud];[1:a]volume=${musicVol}[m_aud];[v_aud][m_aud]amix=inputs=2:duration=first:dropout_transition=2[a_out]`;

  const args = [
    '-y',
    '-i', options.videoPath,
    '-i', options.musicPath,
    '-filter_complex', filter,
    '-map', '0:v:0',
    '-map', '[a_out]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '256k',
    options.outputPath,
  ];

  await runFfmpegCommand(args, {
    abortSignal: options.abortSignal,
    onProgress: options.onProgress,
  });
}
