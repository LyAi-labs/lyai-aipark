import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Studio } from '../services/studio';
import { Scene } from '../models/studio.models';

@Component({
  selector: 'app-voice-view',
  imports: [CommonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 space-y-6 max-w-7xl mx-auto">
      @if (studio.activeProject(); as proj) {
        <!-- Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <div class="flex items-center gap-2">
              <span class="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono text-amber-300">VOICE SYNTHESIS STUDIO</span>
              <span class="text-xs text-zinc-500">Multilingüe & Actuación Vocal</span>
            </div>
            <h1 class="text-xl font-bold tracking-tight text-zinc-100 mt-1">
              Producción de Voces & Doblaje
            </h1>
            <p class="text-xs text-zinc-400 mt-0.5">
              Configura voces por personaje, modulación de pitch/velocidad y sincronización temporal con subtítulos.
            </p>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              (click)="synthesizeAll()"
              [disabled]="isSynthesizing()"
              class="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
            >
              <mat-icon class="!text-sm !w-4 !h-4">{{ isSynthesizing() ? 'sync' : 'multitrack_audio' }}</mat-icon>
              <span>{{ isSynthesizing() ? 'Sintetizando...' : 'Sintetizar Todas las Voces (.WAV)' }}</span>
            </button>
            <button
              type="button"
              (click)="goToAnimation()"
              class="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition-colors shadow-sm"
            >
              <span>Continuar a Animación</span>
              <mat-icon class="!text-sm !w-4 !h-4">arrow_forward</mat-icon>
            </button>
          </div>
        </div>

        <!-- Character Voice Profiles Bar -->
        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-3">
          <h2 class="text-xs font-mono uppercase tracking-wider text-zinc-400">
            Perfiles Vocales Asignados ({{ proj.characters.length }})
          </h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            @for (char of proj.characters; track char.id) {
              <div class="rounded-xl border border-zinc-800 bg-zinc-950 p-3.5 space-y-3">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="font-bold text-sm text-zinc-100">{{ char.name }}</span>
                    <span class="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">{{ char.species }}</span>
                  </div>
                  <button
                    type="button"
                    (click)="testVoice(char.name, '¡Hola amigos! Soy ' + char.name + ' y me encanta explorar.', char.voiceProfile.pitch, char.voiceProfile.speed)"
                    class="flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-700 transition-colors"
                  >
                    <mat-icon class="!text-xs !w-3 !h-3 text-amber-400">volume_up</mat-icon>
                    <span>Test Voz</span>
                  </button>
                </div>

                <div class="space-y-2 text-xs">
                  <div>
                    <label class="block text-[10px] font-mono uppercase text-zinc-500 mb-0.5">Tipo de Voz</label>
                    <input
                      type="text"
                      [value]="char.voiceProfile.voiceType"
                      (change)="updateVoiceType(char.id, $event)"
                      class="w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  <div class="grid grid-cols-2 gap-2">
                    <div>
                      <div class="flex items-center justify-between text-[10px] font-mono text-zinc-500 mb-0.5">
                        <span>Pitch (Tono)</span>
                        <span class="text-zinc-300 font-bold">{{ char.voiceProfile.pitch }}</span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="1.8"
                        step="0.05"
                        [value]="char.voiceProfile.pitch"
                        (input)="updatePitch(char.id, $event)"
                        class="w-full accent-amber-500"
                      />
                    </div>
                    <div>
                      <div class="flex items-center justify-between text-[10px] font-mono text-zinc-500 mb-0.5">
                        <span>Velocidad</span>
                        <span class="text-zinc-300 font-bold">{{ char.voiceProfile.speed }}</span>
                      </div>
                      <input
                        type="range"
                        min="0.6"
                        max="1.4"
                        step="0.05"
                        [value]="char.voiceProfile.speed"
                        (input)="updateSpeed(char.id, $event)"
                        class="w-full accent-amber-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            }
          </div>
        </div>

        <!-- Speech Breakdown by Scenes -->
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <mat-icon class="!text-base !w-4 !h-4 text-amber-400">format_quote</mat-icon>
              <span>Fragmentos de Diálogo y Narración</span>
            </h2>
            <span class="text-xs text-zinc-500 font-mono">Sincronización automatizada</span>
          </div>

          <div class="space-y-3">
            @for (scene of proj.scenes; track scene.id; let idx = $index) {
              <div class="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
                <div class="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <div class="flex items-center gap-2">
                    <span class="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-xs font-bold text-amber-300">
                      {{ scene.scene_id }}
                    </span>
                    <span class="text-xs font-semibold text-zinc-300">{{ scene.location }}</span>
                  </div>

                  <div class="flex items-center gap-2">
                    @if (scene.audioUrl) {
                      <span class="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-400 flex items-center gap-1">
                        <mat-icon class="!text-[12px] !w-3 !h-3">check_circle</mat-icon>
                        <span>WAV Listo ({{ scene.measuredAudioDuration || scene.duration }}s)</span>
                      </span>
                    } @else {
                      <span class="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                        Pendiente
                      </span>
                    }
                    <button
                      type="button"
                      (click)="synthesizeScene(idx)"
                      [disabled]="isSceneSynthesizing(idx)"
                      class="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                    >
                      <mat-icon class="!text-xs !w-3 !h-3 text-amber-400">{{ isSceneSynthesizing(idx) ? 'sync' : 'auto_fix_high' }}</mat-icon>
                      <span>{{ scene.audioUrl ? 'Re-sintetizar' : 'Sintetizar .WAV' }}</span>
                    </button>
                    <!-- Listen Dialogue Button -->
                    <button
                      type="button"
                      (click)="playSceneAudio(scene, idx)"
                      class="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition-colors"
                    >
                      <mat-icon class="!text-sm !w-4 !h-4 text-amber-400">{{ currentlyPlayingScene() === idx ? 'stop' : 'play_arrow' }}</mat-icon>
                      <span>{{ currentlyPlayingScene() === idx ? 'Detener' : 'Escuchar WAV' }}</span>
                    </button>
                  </div>
                </div>

                <!-- Dialogue Line -->
                @if (scene.dialogue) {
                  <div class="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs">
                    <div class="flex items-center justify-between mb-1">
                      <span class="font-mono text-[10px] uppercase font-bold text-amber-400">Diálogo</span>
                      <span class="text-[10px] text-zinc-500">Personajes: {{ scene.characters.join(', ') }}</span>
                    </div>
                    <p class="text-zinc-200 font-medium italic">"{{ scene.dialogue }}"</p>
                  </div>
                }

                <!-- Narration Line -->
                @if (scene.narration) {
                  <div class="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3 text-xs">
                    <div class="flex items-center justify-between mb-1">
                      <span class="font-mono text-[10px] uppercase font-bold text-zinc-400">Narrador en Off</span>
                    </div>
                    <p class="text-zinc-400">{{ scene.narration }}</p>
                  </div>
                }
              </div>
            }
          </div>
        </div>
      }
    </div>
  `
})
export class VoiceView {
  studio = inject(Studio);

  isSynthesizing = signal<boolean>(false);
  synthesizingSceneIdx = signal<number | null>(null);
  currentlyPlayingScene = signal<number | null>(null);
  private currentAudio: HTMLAudioElement | null = null;

  isSceneSynthesizing(idx: number): boolean {
    return this.synthesizingSceneIdx() === idx;
  }

  async synthesizeAll(): Promise<void> {
    this.isSynthesizing.set(true);
    try {
      await this.studio.synthesizeAllEpisodeVoices();
    } finally {
      this.isSynthesizing.set(false);
    }
  }

  async synthesizeScene(idx: number): Promise<void> {
    this.synthesizingSceneIdx.set(idx);
    try {
      await this.studio.synthesizeSceneAudio(idx);
    } finally {
      this.synthesizingSceneIdx.set(null);
    }
  }

  testVoice(speaker: string, text: string, pitch = 1.0, speed = 1.0, voiceType = 'es-ES-Neural2-A'): void {
    this.studio.testCharacterVoice(speaker, text, pitch, speed, voiceType);
  }

  playSceneAudio(scene: Scene, idx: number): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    if (this.currentlyPlayingScene() === idx) {
      this.currentlyPlayingScene.set(null);
      return;
    }

    if (scene.audioUrl) {
      this.currentlyPlayingScene.set(idx);
      this.currentAudio = new Audio(scene.audioUrl);
      this.currentAudio.onended = () => {
        this.currentlyPlayingScene.set(null);
        this.currentAudio = null;
      };
      this.currentAudio.onerror = () => {
        this.currentlyPlayingScene.set(null);
        this.currentAudio = null;
      };
      this.currentAudio.play().catch(() => {
        this.currentlyPlayingScene.set(null);
      });
      return;
    }

    const textToSpeak = scene.dialogue || scene.narration;
    if (!textToSpeak) return;

    this.testVoice(scene.characters[0] || 'Narrador', textToSpeak, 1.05, 0.95);
  }

  updateVoiceType(charId: string, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    const p = this.studio.activeProject();
    if (p) {
      const characters = p.characters.map(c => c.id === charId ? {
        ...c,
        voiceProfile: { ...c.voiceProfile, voiceType: val }
      } : c);
      this.studio.updateProject({ ...p, characters });
    }
  }

  updatePitch(charId: string, event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    const p = this.studio.activeProject();
    if (p) {
      const characters = p.characters.map(c => c.id === charId ? {
        ...c,
        voiceProfile: { ...c.voiceProfile, pitch: val }
      } : c);
      this.studio.updateProject({ ...p, characters });
    }
  }

  updateSpeed(charId: string, event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    const p = this.studio.activeProject();
    if (p) {
      const characters = p.characters.map(c => c.id === charId ? {
        ...c,
        voiceProfile: { ...c.voiceProfile, speed: val }
      } : c);
      this.studio.updateProject({ ...p, characters });
    }
  }

  goToAnimation(): void {
    this.studio.advancePipelineStage('animation');
    this.studio.activeSection.set('animation');
  }
}
