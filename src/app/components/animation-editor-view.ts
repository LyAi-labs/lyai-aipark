import { ChangeDetectionStrategy, Component, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Studio } from '../services/studio';
import { Scene } from '../models/studio.models';

@Component({
  selector: 'app-animation-editor-view',
  imports: [CommonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 space-y-6 max-w-7xl mx-auto">
      @if (studio.activeProject(); as proj) {
        <!-- Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <div class="flex items-center gap-2">
              <span class="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono text-amber-300">
                MULTI-TRACK VIDEO EDITOR
              </span>
              <span class="text-xs text-zinc-500">Composición & Animación Modular</span>
            </div>
            <h1 class="text-xl font-bold tracking-tight text-zinc-100 mt-1">
              Línea de Tiempo & Render
            </h1>
            <p class="text-xs text-zinc-400 mt-0.5">
              Control de pistas: Vídeo, Voces sincronizadas, Banda sonora y Efectos de sonido (SFX).
            </p>
          </div>

          <div class="flex items-center gap-2">
            @if (proj.videoTrack.isRendered && proj.videoTrack.videoUrl) {
              <div class="flex rounded-xl bg-zinc-900 border border-zinc-800 p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  (click)="viewMode.set('animation')"
                  class="rounded-lg px-2.5 py-1.5 transition-colors flex items-center gap-1.5"
                  [class.bg-zinc-800]="viewMode() === 'animation'"
                  [class.text-amber-300]="viewMode() === 'animation'"
                  [class.text-zinc-400]="viewMode() !== 'animation'"
                >
                  <mat-icon class="!text-sm !w-4 !h-4">view_timeline</mat-icon>
                  <span>Multi-Pista</span>
                </button>
                <button
                  type="button"
                  (click)="viewMode.set('video')"
                  class="rounded-lg px-2.5 py-1.5 transition-colors flex items-center gap-1.5"
                  [class.bg-zinc-800]="viewMode() === 'video'"
                  [class.text-emerald-300]="viewMode() === 'video'"
                  [class.text-zinc-400]="viewMode() !== 'video'"
                >
                  <mat-icon class="!text-sm !w-4 !h-4">movie</mat-icon>
                  <span>Vídeo Final MP4</span>
                </button>
              </div>
            }

            <button
              type="button"
              (click)="triggerRender()"
              [disabled]="studio.isRenderingVideo()"
              class="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <mat-icon class="!text-sm !w-4 !h-4" [class.animate-spin]="studio.isRenderingVideo()">sync</mat-icon>
              <span>{{ studio.isRenderingVideo() ? 'Renderizando (' + studio.renderingProgress() + '%)...' : 'Ensamblar & Renderizar Episodio' }}</span>
            </button>
            <button
              type="button"
              (click)="goToQc()"
              class="flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 transition-colors"
            >
              <span>Ir a Control de Calidad (QC)</span>
              <mat-icon class="!text-sm !w-4 !h-4">arrow_forward</mat-icon>
            </button>
          </div>
        </div>

        <!-- FFmpeg Worker Rendering Status Banner -->
        @if (studio.isRenderingVideo()) {
          <div class="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2 shadow-lg">
            <div class="flex items-center justify-between text-xs">
              <div class="flex items-center gap-2 text-amber-300 font-semibold font-mono">
                <mat-icon class="!text-base !w-4 !h-4 animate-spin">autorenew</mat-icon>
                <span>FFMPEG WORKER EN EJECUCIÓN (ASÍNCRONO / 202 ACCEPTED)</span>
              </div>
              <span class="font-mono font-bold text-amber-400 text-sm">{{ studio.renderingProgress() }}%</span>
            </div>
            <div class="w-full bg-zinc-800/80 rounded-full h-2.5 overflow-hidden border border-amber-500/20">
              <div
                class="bg-amber-500 h-full transition-all duration-300 rounded-full"
                [style.width.%]="studio.renderingProgress()"
              ></div>
            </div>
            <p class="text-xs text-zinc-400 font-mono flex items-center gap-1.5">
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span>
              <span>{{ studio.renderingStepDescription() }}</span>
            </p>
          </div>
        }

        <!-- Cinema Player Preview Window -->
        <div class="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl">
          @if (viewMode() === 'video' && proj.videoTrack.isRendered && proj.videoTrack.videoUrl) {
            <!-- Real Rendered MP4 Video Player -->
            <div class="space-y-3">
              <div class="flex items-center justify-between pb-3 border-b border-zinc-800 text-xs">
                <div class="flex items-center gap-2">
                  <span class="h-2 w-2 rounded-full bg-emerald-400"></span>
                  <span class="font-mono text-zinc-200 font-bold">REPRODUCTOR DE VÍDEO COMPUESTO (MP4)</span>
                  <span class="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-mono text-emerald-300 font-semibold">
                    1080p @ 24fps H.264 / AAC
                  </span>
                </div>

                <div class="flex items-center gap-2">
                  <a
                    [href]="proj.videoTrack.videoUrl"
                    download
                    target="_blank"
                    class="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] font-mono text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                  >
                    <mat-icon class="!text-xs !w-3.5 !h-3.5">download</mat-icon>
                    <span>Descargar MP4</span>
                  </a>
                </div>
              </div>

              <!-- Native HTML5 Video Element with WebVTT Subtitles -->
              <div class="relative aspect-video w-full rounded-xl overflow-hidden bg-black border border-zinc-900 shadow-inner flex items-center justify-center">
                <video
                  controls
                  playsinline
                  class="w-full h-full object-contain"
                  [src]="proj.videoTrack.videoUrl"
                >
                  @if (proj.videoTrack.subtitlesVtt) {
                    <track
                      [src]="subtitlesVttBlobUrl()"
                      kind="subtitles"
                      srclang="es"
                      label="Español (Sincronizado)"
                      default
                    />
                  }
                  Tu navegador no soporta reproducción de vídeo HTML5.
                </video>
              </div>
            </div>
          } @else {
            <!-- Animation / Scene Viewport Preview -->
            <div class="flex items-center justify-between pb-3 border-b border-zinc-800 text-xs">
              <div class="flex items-center gap-2">
                <span class="h-2 w-2 rounded-full" [class.bg-emerald-400]="isPlaying()" [class.bg-zinc-600]="!isPlaying()"></span>
                <span class="font-mono text-zinc-300 font-semibold">{{ currentScene()?.scene_id || 'SCENE_01' }}</span>
                <span class="text-zinc-500">· {{ currentScene()?.location }}</span>
              </div>

              <!-- Timecode -->
              <div class="font-mono text-sm font-bold text-amber-400">
                {{ formattedPlayheadTime }} / {{ formattedTotalTime }}
              </div>
            </div>

            <!-- Video viewport container with animation effect -->
            <div class="relative mt-3 aspect-video w-full rounded-xl overflow-hidden bg-black border border-zinc-900 shadow-inner flex items-center justify-center">
              @if (currentScene(); as sc) {
                <div
                  class="w-full h-full object-cover transition-transform duration-1000 ease-out flex items-center justify-center"
                  [class.scale-105]="isPlaying() && sc.motionType === 'zoom-in'"
                  [class.scale-95]="isPlaying() && sc.motionType === 'zoom-out'"
                  [class.translate-x-2]="isPlaying() && sc.motionType === 'pan-right'"
                  [class.-translate-x-2]="isPlaying() && sc.motionType === 'pan-left'"
                >
                  @if (sc.imageUrl) {
                    <img [src]="sc.imageUrl" alt="Visual de escena ráster" class="w-full h-full object-cover" />
                  } @else {
                    <div [innerHTML]="sc.visualSvg" class="w-full h-full"></div>
                  }
                </div>

                <!-- Animated Subtitles WebVTT Overlay -->
                @if (sc.dialogue || sc.narration) {
                  <div class="absolute bottom-6 inset-x-8 flex justify-center pointer-events-none">
                    <div class="rounded-lg bg-black/85 px-4 py-2 border border-zinc-800/80 shadow-2xl text-center max-w-xl">
                      <p class="text-sm font-semibold text-amber-200 tracking-wide drop-shadow-md">
                        {{ sc.dialogue || sc.narration }}
                      </p>
                    </div>
                  </div>
                }
              }

              <!-- Camera motion badge -->
              <div class="absolute top-4 left-4 rounded-md bg-black/70 backdrop-blur-sm px-2.5 py-1 text-[11px] font-mono text-zinc-300 border border-zinc-800">
                CÁMARA: {{ currentScene()?.motionType || 'ken-burns' | uppercase }}
              </div>
            </div>
          }

          <!-- Transport Controls -->
          <div class="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-zinc-800">
            <div class="flex items-center gap-2">
              <!-- Rewind -->
              <button
                type="button"
                (click)="rewind()"
                class="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 transition-colors"
                title="Rebobinar al inicio"
              >
                <mat-icon class="!text-base !w-4 !h-4">skip_previous</mat-icon>
              </button>

              <!-- Play / Pause -->
              <button
                type="button"
                (click)="togglePlay()"
                class="flex h-9 px-4 items-center gap-1.5 rounded-lg bg-zinc-100 font-bold text-xs text-zinc-950 hover:bg-zinc-200 transition-colors shadow-sm"
              >
                <mat-icon class="!text-base !w-4 !h-4">{{ isPlaying() ? 'pause' : 'play_arrow' }}</mat-icon>
                <span>{{ isPlaying() ? 'Pausar' : 'Reproducir' }}</span>
              </button>

              <!-- Stop -->
              <button
                type="button"
                (click)="stop()"
                class="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 transition-colors"
                title="Detener"
              >
                <mat-icon class="!text-base !w-4 !h-4">stop</mat-icon>
              </button>
            </div>

            <!-- Volume Mixers Quick Controls -->
            <div class="flex items-center gap-4 text-xs text-zinc-400">
              <div class="flex items-center gap-1.5">
                <mat-icon class="!text-sm !w-4 !h-4 text-zinc-500">record_voice_over</mat-icon>
                <span>Voz:</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  [value]="proj.videoTrack.voiceVolume"
                  (input)="updateTrackVolume('voice', $event)"
                  class="w-16 accent-amber-500"
                />
              </div>

              <div class="flex items-center gap-1.5">
                <mat-icon class="!text-sm !w-4 !h-4 text-zinc-500">music_note</mat-icon>
                <span>Música:</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  [value]="proj.videoTrack.musicVolume"
                  (input)="updateTrackVolume('music', $event)"
                  class="w-16 accent-amber-500"
                />
              </div>

              <div class="flex items-center gap-1.5">
                <mat-icon class="!text-sm !w-4 !h-4 text-zinc-500">graphic_eq</mat-icon>
                <span>SFX:</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  [value]="proj.videoTrack.sfxVolume"
                  (input)="updateTrackVolume('sfx', $event)"
                  class="w-16 accent-amber-500"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Multi-track Studio Timeline -->
        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
          <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
            <h3 class="text-xs font-mono uppercase tracking-wider text-zinc-300 flex items-center gap-2">
              <mat-icon class="!text-base !w-4 !h-4 text-amber-400">view_timeline</mat-icon>
              <span>Línea de Tiempo Multi-Pista</span>
            </h3>
            <span class="text-[11px] font-mono text-zinc-500">Resolución: 1080p @ 24fps</span>
          </div>

          <!-- Timeline Ruler -->
          <div class="relative w-full h-6 border-b border-zinc-800 font-mono text-[10px] text-zinc-500 flex items-center justify-between px-2 pl-24">
            <span>00:00</span>
            <span>00:15</span>
            <span>00:30</span>
            <span>00:45</span>
            <span>01:00</span>
            <span>01:15</span>
          </div>

          <!-- TRACK 1: VIDEO TRACK -->
          <div class="flex items-center gap-3">
            <div class="w-20 shrink-0 font-mono text-xs font-bold text-zinc-400 flex items-center gap-1">
              <mat-icon class="!text-xs !w-3.5 !h-3.5 text-blue-400">videocam</mat-icon>
              <span>VIDEO</span>
            </div>

            <div class="flex-1 flex gap-2 h-14 bg-zinc-950/80 rounded-xl p-1.5 border border-zinc-800 overflow-x-auto">
              @for (sc of proj.scenes; track sc.id; let idx = $index) {
                <div
                  (click)="selectScene(idx)"
                  class="h-full rounded-lg border px-3 flex flex-col justify-center cursor-pointer transition-all min-w-[120px] flex-1"
                  [class.border-amber-500]="currentSceneIndex() === idx"
                  [class.bg-amber-500/15]="currentSceneIndex() === idx"
                  [class.border-zinc-800]="currentSceneIndex() !== idx"
                  [class.bg-zinc-900]="currentSceneIndex() !== idx"
                >
                  <div class="flex items-center justify-between font-mono text-[10px]">
                    <span class="font-bold text-zinc-200">{{ sc.scene_id }}</span>
                    <span class="text-zinc-500">{{ sc.duration }}s</span>
                  </div>
                  <div class="truncate text-[11px] text-zinc-400 mt-0.5">{{ sc.location }}</div>
                </div>
              }
            </div>
          </div>

          <!-- TRACK 2: VOICE TRACK -->
          <div class="flex items-center gap-3">
            <div class="w-20 shrink-0 font-mono text-xs font-bold text-zinc-400 flex items-center gap-1">
              <mat-icon class="!text-xs !w-3.5 !h-3.5 text-emerald-400">record_voice_over</mat-icon>
              <span>VOICE</span>
            </div>

            <div class="flex-1 flex gap-2 h-11 bg-zinc-950/80 rounded-xl p-1.5 border border-zinc-800 overflow-x-auto">
              @for (sc of proj.scenes; track sc.id; let idx = $index) {
                <div
                  class="h-full rounded-lg bg-emerald-950/40 border border-emerald-500/30 px-2.5 flex items-center justify-between flex-1 min-w-[120px]"
                >
                  <span class="text-[10px] text-emerald-300 truncate font-mono">
                    {{ sc.characters[0] || 'Voz' }}: {{ sc.dialogue.substring(0, 16) }}...
                  </span>
                  <mat-icon class="!text-xs !w-3 !h-3 text-emerald-400">graphic_eq</mat-icon>
                </div>
              }
            </div>
          </div>

          <!-- TRACK 3: MUSIC TRACK -->
          <div class="flex items-center gap-3">
            <div class="w-20 shrink-0 font-mono text-xs font-bold text-zinc-400 flex items-center gap-1">
              <mat-icon class="!text-xs !w-3.5 !h-3.5 text-purple-400">music_note</mat-icon>
              <span>MUSIC</span>
            </div>

            <div class="flex-1 h-10 bg-zinc-950/80 rounded-xl p-1 border border-zinc-800">
              <div class="h-full rounded-lg bg-purple-950/40 border border-purple-500/30 px-3 flex items-center justify-between text-xs text-purple-300">
                <span class="text-[11px] font-mono truncate">KidsToon Main Theme · Xilófono & Pizzicato Strings (110 BPM)</span>
                <span class="font-mono text-[10px] text-purple-400">LOOP</span>
              </div>
            </div>
          </div>

          <!-- TRACK 4: SFX TRACK -->
          <div class="flex items-center gap-3">
            <div class="w-20 shrink-0 font-mono text-xs font-bold text-zinc-400 flex items-center gap-1">
              <mat-icon class="!text-xs !w-3.5 !h-3.5 text-amber-400">auto_fix_high</mat-icon>
              <span>SFX</span>
            </div>

            <div class="flex-1 flex gap-2 h-9 bg-zinc-950/80 rounded-xl p-1 border border-zinc-800">
              @for (sc of proj.scenes; track sc.id; let idx = $index) {
                <div class="h-full rounded bg-amber-950/30 border border-amber-500/20 px-2 flex items-center text-[10px] text-amber-400 font-mono truncate flex-1">
                  {{ sc.sound_effects.substring(0, 15) }}...
                </div>
              }
            </div>
          </div>
        </div>

        <!-- Subtitles Code Preview (SRT & WebVTT) -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="rounded-xl border border-zinc-800 bg-zinc-950 p-3.5">
            <div class="flex items-center justify-between text-xs font-mono text-zinc-400 mb-2 border-b border-zinc-800 pb-2">
              <span>subtitles_es.vtt (WebVTT para YouTube)</span>
              <button type="button" (click)="copyText(proj.videoTrack.subtitlesVtt)" class="hover:text-zinc-200">Copiar</button>
            </div>
            <pre class="font-mono text-[11px] text-zinc-400 max-h-36 overflow-y-auto leading-relaxed">{{ proj.videoTrack.subtitlesVtt }}</pre>
          </div>

          <div class="rounded-xl border border-zinc-800 bg-zinc-950 p-3.5">
            <div class="flex items-center justify-between text-xs font-mono text-zinc-400 mb-2 border-b border-zinc-800 pb-2">
              <span>subtitles_es.srt (SubRip Format)</span>
              <button type="button" (click)="copyText(proj.videoTrack.subtitlesSrt)" class="hover:text-zinc-200">Copiar</button>
            </div>
            <pre class="font-mono text-[11px] text-zinc-400 max-h-36 overflow-y-auto leading-relaxed">{{ proj.videoTrack.subtitlesSrt }}</pre>
          </div>
        </div>
      }
    </div>
  `
})
export class AnimationEditorView implements OnDestroy {
  studio = inject(Studio);

  viewMode = signal<'animation' | 'video'>('animation');
  currentSceneIndex = signal<number>(0);
  isPlaying = signal<boolean>(false);
  playheadSeconds = signal<number>(0);
  private timerInterval: any = null;

  subtitlesVttBlobUrl(): string | undefined {
    const vtt = this.studio.activeProject()?.videoTrack?.subtitlesVtt;
    if (!vtt) return undefined;
    const blob = new Blob([vtt], { type: 'text/vtt' });
    return URL.createObjectURL(blob);
  }

  currentScene() {
    const p = this.studio.activeProject();
    if (!p || p.scenes.length === 0) return null;
    return p.scenes[this.currentSceneIndex()] || p.scenes[0];
  }

  get totalDuration(): number {
    const p = this.studio.activeProject();
    if (!p) return 0;
    return p.scenes.reduce((acc, s) => acc + s.duration, 0);
  }

  get formattedPlayheadTime(): string {
    const s = this.playheadSeconds();
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }

  get formattedTotalTime(): string {
    const s = this.totalDuration;
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }

  togglePlay(): void {
    if (this.isPlaying()) {
      this.pause();
    } else {
      this.play();
    }
  }

  play(): void {
    this.isPlaying.set(true);
    clearInterval(this.timerInterval);

    this.timerInterval = setInterval(() => {
      const nextSec = this.playheadSeconds() + 1;
      if (nextSec >= this.totalDuration) {
        this.stop();
        return;
      }
      this.playheadSeconds.set(nextSec);

      // Check scene step
      const p = this.studio.activeProject();
      if (p) {
        let acc = 0;
        for (let i = 0; i < p.scenes.length; i++) {
          acc += p.scenes[i].duration;
          if (nextSec < acc) {
            this.currentSceneIndex.set(i);
            break;
          }
        }
      }
    }, 1000);
  }

  pause(): void {
    this.isPlaying.set(false);
    clearInterval(this.timerInterval);
  }

  stop(): void {
    this.pause();
    this.playheadSeconds.set(0);
    this.currentSceneIndex.set(0);
  }

  rewind(): void {
    this.stop();
  }

  selectScene(index: number): void {
    this.currentSceneIndex.set(index);
    const p = this.studio.activeProject();
    if (p) {
      let time = 0;
      for (let i = 0; i < index; i++) {
        time += p.scenes[i].duration;
      }
      this.playheadSeconds.set(time);
    }
  }

  updateTrackVolume(track: 'music' | 'voice' | 'sfx', event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    const p = this.studio.activeProject();
    if (p) {
      const config = { ...p.videoTrack };
      if (track === 'music') config.musicVolume = val;
      if (track === 'voice') config.voiceVolume = val;
      if (track === 'sfx') config.sfxVolume = val;
      this.studio.updateProject({ ...p, videoTrack: config });
    }
  }

  copyText(txt: string): void {
    navigator.clipboard.writeText(txt);
  }

  async triggerRender(): Promise<void> {
    await this.studio.renderVideo();
    if (this.studio.activeProject()?.videoTrack?.isRendered) {
      this.viewMode.set('video');
    }
  }

  goToQc(): void {
    this.studio.advancePipelineStage('qc');
    this.studio.activeSection.set('qc');
  }

  ngOnDestroy(): void {
    clearInterval(this.timerInterval);
  }
}
