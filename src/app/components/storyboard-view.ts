import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Studio } from '../services/studio';
import { Scene } from '../models/studio.models';

@Component({
  selector: 'app-storyboard-view',
  imports: [CommonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 space-y-6 max-w-7xl mx-auto">
      @if (studio.activeProject(); as proj) {
        <!-- Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <div class="flex items-center gap-2">
              <span class="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono text-amber-300">STORYBOARD COMPOSER</span>
              <span class="text-xs text-zinc-500">{{ proj.scenes.length }} Escenas en Secuencia</span>
            </div>
            <h1 class="text-xl font-bold tracking-tight text-zinc-100 mt-1">
              Storyboard & Puesta en Escena
            </h1>
            <p class="text-xs text-zinc-400 mt-0.5">
              Control fotograma a fotograma: encuadres, acciones, duración y diálogos con consistencia de estilo.
            </p>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              (click)="studio.generateAllEpisodeVisuals()"
              [disabled]="studio.isGeneratingVisuals()"
              class="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <mat-icon class="!text-sm !w-4 !h-4" [class.animate-spin]="studio.isGeneratingVisuals()">
                {{ studio.isGeneratingVisuals() ? 'autorenew' : 'photo_library' }}
              </mat-icon>
              <span>{{ studio.isGeneratingVisuals() ? 'Generando Visuales...' : 'Generar Todo el Storyboard (Ráster 16:9)' }}</span>
            </button>

            <button
              type="button"
              (click)="goToVoice()"
              class="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition-colors shadow-sm"
            >
              <span>Continuar a Voces & Audio</span>
              <mat-icon class="!text-sm !w-4 !h-4">arrow_forward</mat-icon>
            </button>
          </div>
        </div>

        <!-- Storyboard Scenes Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
          @for (scene of proj.scenes; track scene.id; let idx = $index) {
            <div class="group rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4 hover:border-zinc-700 transition-all shadow-md">
              <!-- Scene Card Header -->
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="rounded bg-amber-500 px-2.5 py-0.5 font-mono text-xs font-bold text-zinc-950">
                    {{ scene.scene_id }}
                  </span>
                  <span class="text-xs font-bold text-zinc-200">{{ scene.location }}</span>
                  <span class="text-xs text-zinc-500">· {{ scene.time }}</span>
                </div>

                <!-- Reorder & Action Controls -->
                <div class="flex items-center gap-1">
                  <!-- Move Left/Up -->
                  <button
                    type="button"
                    (click)="studio.reorderScenes(idx, idx - 1)"
                    [disabled]="idx === 0"
                    class="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Mover Escena Antes"
                  >
                    <mat-icon class="!text-base !w-4 !h-4">arrow_back</mat-icon>
                  </button>

                  <!-- Move Right/Down -->
                  <button
                    type="button"
                    (click)="studio.reorderScenes(idx, idx + 1)"
                    [disabled]="idx === proj.scenes.length - 1"
                    class="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Mover Escena Después"
                  >
                    <mat-icon class="!text-base !w-4 !h-4">arrow_forward</mat-icon>
                  </button>

                  <!-- Duplicate -->
                  <button
                    type="button"
                    (click)="studio.duplicateScene(scene.id)"
                    class="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                    title="Duplicar Escena"
                  >
                    <mat-icon class="!text-base !w-4 !h-4">content_copy</mat-icon>
                  </button>

                  <!-- Delete -->
                  <button
                    type="button"
                    (click)="studio.deleteScene(scene.id)"
                    [disabled]="proj.scenes.length <= 1"
                    class="rounded-lg p-1 text-zinc-400 hover:bg-rose-500/20 hover:text-rose-400 disabled:opacity-30 transition-colors"
                    title="Eliminar Escena"
                  >
                    <mat-icon class="!text-base !w-4 !h-4">delete</mat-icon>
                  </button>
                </div>
              </div>

              <!-- 16:9 Cinematic Image Container -->
              <div class="relative aspect-video w-full rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950 shadow-inner group/img">
                @if (scene.imageUrl) {
                  <img [src]="scene.imageUrl" class="w-full h-full object-cover transition-transform duration-300 group-hover/img:scale-105" [alt]="scene.scene_id" />
                } @else if (scene.visualSvg) {
                  <div [innerHTML]="scene.visualSvg" class="w-full h-full object-cover"></div>
                }

                <!-- Visual State Loading Overlay -->
                @if (scene.visualState === 'generating') {
                  <div class="absolute inset-0 bg-zinc-950/85 backdrop-blur-sm flex flex-col items-center justify-center gap-2 z-20">
                    <mat-icon class="!text-2xl !w-6 !h-6 text-amber-400 animate-spin">autorenew</mat-icon>
                    <span class="text-xs font-mono text-zinc-300">Generando PNG 16:9...</span>
                  </div>
                }

                <!-- Raster vs SVG Format Badge (Top Right) -->
                <div class="absolute top-2 right-2 z-10">
                  @if (scene.imageUrl) {
                    <span class="rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 text-[9px] font-mono font-bold flex items-center gap-1 shadow-sm">
                      <mat-icon class="!text-xs !w-3 !h-3 text-emerald-400">image</mat-icon>
                      <span>16:9 PNG RÁSTER</span>
                    </span>
                  } @else {
                    <span class="rounded bg-zinc-900/80 text-zinc-400 border border-zinc-700/60 px-2 py-0.5 text-[9px] font-mono flex items-center gap-1 shadow-sm">
                      <mat-icon class="!text-xs !w-3 !h-3 text-amber-400">auto_awesome</mat-icon>
                      <span>SVG PREVIEW</span>
                    </span>
                  }
                </div>

                <!-- Image Quick Controls Overlay -->
                <div class="absolute inset-0 bg-black/60 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2 p-4 z-10">
                  <button
                    type="button"
                    (click)="studio.generateSceneRasterVisual(idx)"
                    class="flex items-center gap-1.5 rounded-lg bg-zinc-900/90 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-amber-500 hover:text-zinc-950 transition-colors shadow-lg border border-zinc-700"
                  >
                    <mat-icon class="!text-sm !w-4 !h-4">photo_library</mat-icon>
                    <span>Generar PNG 16:9</span>
                  </button>
                </div>

                <!-- Camera Motion Tag Badge -->
                <div class="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-zinc-950/80 px-2 py-0.5 text-[10px] font-mono text-zinc-300 border border-zinc-800">
                  <mat-icon class="!text-xs !w-3 !h-3 text-amber-400">videocam</mat-icon>
                  <span>{{ scene.camera }}</span>
                </div>

                <!-- Duration Badge -->
                <div class="absolute bottom-2 right-2 rounded-md bg-zinc-950/80 px-2 py-0.5 text-[10px] font-mono text-zinc-300 border border-zinc-800">
                  00:{{ scene.duration < 10 ? '0' + scene.duration : scene.duration }}
                </div>
              </div>

              <!-- Character Tags -->
              <div class="flex items-center gap-2">
                <span class="text-[10px] font-mono uppercase text-zinc-500">Personajes:</span>
                <div class="flex items-center gap-1.5 flex-wrap">
                  @for (charName of scene.characters; track charName) {
                    <span class="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                      {{ charName }}
                    </span>
                  }
                </div>
              </div>

              <!-- Action & Story Text -->
              <div class="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3 space-y-2 text-xs">
                <div>
                  <span class="text-[10px] font-mono uppercase text-zinc-500">Acción:</span>
                  <p class="text-zinc-300 mt-0.5">{{ scene.action }}</p>
                </div>
                <div class="border-t border-zinc-800/80 pt-2">
                  <span class="text-[10px] font-mono uppercase text-amber-400/90">Diálogo:</span>
                  <p class="text-zinc-100 font-medium mt-0.5 italic">"{{ scene.dialogue }}"</p>
                </div>
              </div>

              <!-- Edit Controls: Camera & Duration Selectors -->
              <div class="grid grid-cols-2 gap-3 pt-1 text-xs">
                <div>
                  <label class="block text-[10px] font-mono uppercase text-zinc-500 mb-1">
                    Movimiento de Cámara
                  </label>
                  <select
                    [value]="scene.motionType"
                    (change)="updateMotion(scene.id, $event)"
                    class="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-300 focus:border-amber-500 focus:outline-none"
                  >
                    <option value="pan-left">Pan Izquierda</option>
                    <option value="pan-right">Pan Derecha</option>
                    <option value="zoom-in">Zoom In (Acercamiento)</option>
                    <option value="zoom-out">Zoom Out (Alejamiento)</option>
                    <option value="ken-burns">Ken Burns Cinemático</option>
                    <option value="static">Fija / Estática</option>
                  </select>
                </div>

                <div>
                  <label class="block text-[10px] font-mono uppercase text-zinc-500 mb-1">
                    Duración (segundos)
                  </label>
                  <input
                    type="number"
                    [value]="scene.duration"
                    (change)="updateDuration(scene.id, $event)"
                    min="5"
                    max="60"
                    class="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs font-mono text-zinc-300 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `
})
export class StoryboardView {
  studio = inject(Studio);

  updateMotion(sceneId: string, event: Event): void {
    const val = (event.target as HTMLSelectElement).value as any;
    const p = this.studio.activeProject();
    if (p) {
      const scenes = p.scenes.map(s => s.id === sceneId ? { ...s, motionType: val } : s);
      this.studio.updateProject({ ...p, scenes });
    }
  }

  updateDuration(sceneId: string, event: Event): void {
    const val = Number((event.target as HTMLInputElement).value) || 16;
    const p = this.studio.activeProject();
    if (p) {
      const scenes = p.scenes.map(s => s.id === sceneId ? { ...s, duration: val } : s);
      this.studio.updateProject({ ...p, scenes });
    }
  }

  goToVoice(): void {
    this.studio.advancePipelineStage('voice');
    this.studio.activeSection.set('voice');
  }
}
