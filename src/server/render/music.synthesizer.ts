/**
 * Cartoon Studio — Preschool Background Music Synthesizer
 * Phase 08: Real Video Rendering Engine (FFmpeg Worker)
 *
 * Implements mechanical, first-principles synthesis of playful, gentle preschool
 * background instrumental music (pizzicato strings & marimba/xylophone chords)
 * aligned to exact episode duration.
 * Zero external libraries. Pure Buffer PCM manipulation.
 */

import { createWavHeader } from '../audio/wav.utils';

export interface MusicSynthesisOptions {
  sampleRate?: number;    // default 44100
  bpm?: number;           // default 110
  channels?: number;      // default 2 (stereo)
  volume?: number;        // default 0.6
}

// Frequency table for preschool chord progression in C major
const NOTE_FREQS: Record<string, number> = {
  'C3': 130.81, 'E3': 164.81, 'F3': 174.61, 'G3': 196.00, 'A3': 220.00, 'B3': 246.94,
  'C4': 261.63, 'D4': 293.66, 'E4': 329.63, 'F4': 349.23, 'G4': 392.00, 'A4': 440.00, 'B4': 493.88,
  'C5': 523.25, 'D5': 587.33, 'E5': 659.25, 'G5': 783.99,
};

// 4-bar preschool harmonic loop: C -> G -> Am -> F
interface BarPattern {
  bass: string;
  chords: string[];
  melody: string[];
}

const SONG_LOOP: BarPattern[] = [
  {
    bass: 'C3',
    chords: ['C4', 'E4', 'G4'],
    melody: ['C5', 'E5', 'G5', 'E5'],
  },
  {
    bass: 'G3',
    chords: ['B3', 'D4', 'G4'],
    melody: ['D5', 'G5', 'D5', 'B4'],
  },
  {
    bass: 'A3',
    chords: ['A3', 'C4', 'E4'],
    melody: ['C5', 'E5', 'A4', 'C5'],
  },
  {
    bass: 'F3',
    chords: ['F3', 'A3', 'C4'],
    melody: ['A4', 'C5', 'F4', 'G4'],
  },
];

/**
 * Generates a complete 16-bit PCM WAV background music track of exact duration.
 */
export function synthesizePreschoolMusic(
  durationSeconds: number,
  options: MusicSynthesisOptions = {}
): Buffer {
  const sampleRate = options.sampleRate ?? 44100;
  const bpm = options.bpm ?? 110;
  const numChannels = options.channels ?? 2;
  const masterVolume = Math.min(1.0, Math.max(0.1, options.volume ?? 0.6));

  const safeDuration = Math.max(1, durationSeconds);
  const totalSamples = Math.ceil(safeDuration * sampleRate);
  const bytesPerSample = 2; // 16-bit
  const dataSize = totalSamples * numChannels * bytesPerSample;

  const header = createWavHeader({
    sampleRate,
    numChannels,
    bitsPerSample: 16,
    dataSize,
  });

  const pcmBuffer = Buffer.alloc(dataSize);

  const beatDuration = 60 / bpm; // e.g. ~0.545s
  const barDuration = beatDuration * 4; // 4 beats per bar (~2.18s)
  const eighthDuration = beatDuration / 2;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;

    // Which bar are we in?
    const loopTime = t % (barDuration * SONG_LOOP.length);
    const barIndex = Math.min(SONG_LOOP.length - 1, Math.floor(loopTime / barDuration));
    const timeInBar = loopTime % barDuration;
    const currentBar = SONG_LOOP[barIndex];

    // 1. Bass voice (soft plucked low root note every 2 beats)
    const bassBeatIndex = Math.floor(timeInBar / (beatDuration * 2));
    const timeInBassBeat = timeInBar - (bassBeatIndex * beatDuration * 2);
    const bassFreq = NOTE_FREQS[currentBar.bass] ?? 130.81;
    const bassEnv = Math.exp(-timeInBassBeat * 3.5); // Pluck decay
    const bassSample = Math.sin(2 * Math.PI * bassFreq * t) * 0.35 * bassEnv;

    // 2. Chords accompaniment (xylophone / pizzicato on beats 2 and 4)
    let chordSample = 0;
    const currentBeat = Math.floor(timeInBar / beatDuration);
    if (currentBeat === 1 || currentBeat === 3) {
      const timeInChord = timeInBar - (currentBeat * beatDuration);
      const chordEnv = Math.exp(-timeInChord * 7.0);
      for (const note of currentBar.chords) {
        const freq = NOTE_FREQS[note] ?? 261.63;
        chordSample += (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(4 * Math.PI * freq * t)) * (0.15 / currentBar.chords.length) * chordEnv;
      }
    }

    // 3. Melody voice (gentle marimba on eighth notes)
    const melodyIndex = Math.floor(timeInBar / eighthDuration) % currentBar.melody.length;
    const timeInMelody = timeInBar - (Math.floor(timeInBar / eighthDuration) * eighthDuration);
    const melodyNote = currentBar.melody[melodyIndex];
    const melodyFreq = NOTE_FREQS[melodyNote] ?? 523.25;
    // Marimba has fundamental + weak 3rd harmonic + fast decay
    const melodyEnv = Math.exp(-timeInMelody * 9.0);
    const melodySample = (
      Math.sin(2 * Math.PI * melodyFreq * t) +
      0.25 * Math.sin(6 * Math.PI * melodyFreq * t)
    ) * 0.28 * melodyEnv;

    // Mix voices
    const rawMix = (bassSample + chordSample + melodySample) * masterVolume;

    // Soft fade in (first 0.5s) and fade out (last 1.0s)
    let envelope = 1.0;
    if (t < 0.5) {
      envelope = t / 0.5;
    } else if (t > safeDuration - 1.0) {
      envelope = Math.max(0, (safeDuration - t) / 1.0);
    }

    const finalSample = Math.max(-0.95, Math.min(0.95, rawMix * envelope));
    const int16Val = Math.round(finalSample * 32767);

    const offset = i * numChannels * bytesPerSample;
    // Left channel
    pcmBuffer.writeInt16LE(int16Val, offset);
    if (numChannels === 2) {
      // Right channel (slight stereo delay/phase nuance)
      pcmBuffer.writeInt16LE(int16Val, offset + 2);
    }
  }

  return Buffer.concat([header, pcmBuffer]);
}
