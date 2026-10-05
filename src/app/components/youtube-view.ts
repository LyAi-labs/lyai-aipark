import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Studio } from '../services/studio';

@Component({
  selector: 'app-youtube-view',
  imports: [CommonModule, ReactiveFormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 space-y-6 max-w-7xl mx-auto">
      @if (studio.activeProject(); as proj) {
        <!-- Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <div class="flex items-center gap-2">
              <span class="rounded bg-red-600/10 px-2 py-0.5 text-[10px] font-mono text-red-400">
                YOUTUBE DATA API V3 PUBLISHING
              </span>
              <span class="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-amber-300">
                DEFAULT: PRIVATE (CONTROL HUMANO)
              </span>
            </div>
            <h1 class="text-xl font-bold tracking-tight text-zinc-100 mt-1">
              Publicación & Metadatos YouTube Kids
            </h1>
            <p class="text-xs text-zinc-400 mt-0.5">
              Configuración de privacidad, clasificación COPPA, descripción SEO optimizada y subida controlada.
            </p>
          </div>

          <div class="flex items-center gap-2">
            <!-- Regenerate Metadata -->
            <button
              type="button"
              (click)="regenerateMetadata()"
              class="flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 transition-colors"
            >
              <mat-icon class="!text-sm !w-4 !h-4 text-amber-400">autorenew</mat-icon>
              <span>Regenerar SEO Gemini</span>
            </button>

            <!-- Upload Button (Default Private) -->
            <button
              type="button"
              (click)="executePublish()"
              [disabled]="isPublishing()"
              class="flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2 text-xs font-bold text-white hover:bg-red-500 transition-colors shadow-lg disabled:opacity-50"
            >
              @if (isPublishing()) {
                <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                <span>Procesando Subida...</span>
              } @else {
                <mat-icon class="!text-sm !w-4 !h-4">file_upload</mat-icon>
                <span>Subir a YouTube ({{ privacyStatus() | uppercase }})</span>
              }
            </button>
          </div>
        </div>

        <!-- Connected Channel Card -->
        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div class="flex items-center gap-4">
              <img
                [src]="studio.channelInfo().avatarUrl"
                alt="Channel Avatar"
                referrerpolicy="no-referrer"
                class="h-12 w-12 rounded-full border border-zinc-700 object-cover"
              />
              <div>
                <div class="flex items-center gap-2">
                  <h2 class="text-sm font-bold text-zinc-100">{{ studio.channelInfo().channelTitle }}</h2>
                  <span class="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono text-emerald-400">
                    CONECTADO OAUTH 2.0
                  </span>
                  @if (studio.channelInfo().isDemoMode) {
                    <span class="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-amber-300">
                      DEMO DATA
                    </span>
                  }
                </div>
                <p class="text-xs text-zinc-400 mt-0.5">{{ studio.channelInfo().channelCustomUrl }} · ID: {{ studio.channelInfo().channelId }}</p>
              </div>
            </div>

            <div class="flex items-center gap-6 font-mono text-xs">
              <div>
                <span class="text-zinc-500 block text-[10px]">Suscriptores</span>
                <span class="text-zinc-200 font-bold text-sm">{{ studio.channelInfo().subscriberCount }}</span>
              </div>
              <div class="border-l border-zinc-800 pl-4">
                <span class="text-zinc-500 block text-[10px]">Vídeos en Canal</span>
                <span class="text-zinc-200 font-bold text-sm">{{ studio.channelInfo().videoCount }}</span>
              </div>
              <div class="border-l border-zinc-800 pl-4">
                @if (studio.channelInfo().isDemoMode) {
                  <button
                    type="button"
                    (click)="studio.connectYouTube()"
                    class="flex items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 transition-colors"
                    title="Iniciar flujo de consentimiento Google OAuth 2.0"
                  >
                    <mat-icon class="!text-sm !w-4 !h-4 text-red-400">link</mat-icon>
                    <span>Vincular Canal Real</span>
                  </button>
                } @else {
                  <button
                    type="button"
                    (click)="studio.disconnectYouTube()"
                    class="flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    <mat-icon class="!text-sm !w-4 !h-4 text-zinc-400">link_off</mat-icon>
                    <span>Desconectar</span>
                  </button>
                }
              </div>
            </div>
          </div>
        </div>

        <!-- Publication Success Notice Banner -->
        @if (publishSuccessMessage()) {
          <div class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center justify-between text-xs text-emerald-200">
            <div class="flex items-center gap-2">
              <mat-icon class="text-emerald-400">check_circle</mat-icon>
              <span>{{ publishSuccessMessage() }}</span>
            </div>
            <a
              [href]="proj.youtubeMetadata?.publishedVideoUrl || 'https://youtube.com'"
              target="_blank"
              class="font-mono underline text-emerald-300 hover:text-white"
            >
              Abrir en YouTube Studio →
            </a>
          </div>
        }

        <!-- Publication Settings & Metadata Form -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Left 2 Cols: Title, Description, Tags -->
          <div class="lg:col-span-2 space-y-4">
            <!-- Video Title -->
            <div class="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div class="flex items-center justify-between mb-1.5">
                <label class="text-xs font-mono uppercase text-zinc-300">
                  Título del Vídeo en YouTube
                </label>
                <span class="text-[10px] font-mono text-zinc-500">
                  {{ (proj.youtubeMetadata?.title || proj.title).length }} / 100 caracteres
                </span>
              </div>
              <input
                type="text"
                [value]="proj.youtubeMetadata?.title || proj.title"
                (input)="updateTitle($event)"
                class="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs font-semibold text-zinc-100 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <!-- Description -->
            <div class="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div class="flex items-center justify-between mb-1.5">
                <label class="text-xs font-mono uppercase text-zinc-300">
                  Descripción (Con Timestamps & SEO)
                </label>
                <span class="text-[10px] font-mono text-zinc-500">Formato YouTube Studio</span>
              </div>
              <textarea
                [value]="proj.youtubeMetadata?.description || ''"
                (input)="updateDescription($event)"
                rows="8"
                class="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs font-mono text-zinc-200 focus:border-amber-500 focus:outline-none leading-relaxed"
              ></textarea>
            </div>

            <!-- Tags & Hashtags -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div class="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <label class="block text-xs font-mono uppercase text-zinc-300 mb-1.5">
                  Etiquetas (Keywords)
                </label>
                <div class="flex flex-wrap gap-1.5">
                  @for (tag of proj.youtubeMetadata?.tags || []; track tag) {
                    <span class="rounded bg-zinc-800 px-2 py-1 text-[11px] font-mono text-zinc-300">
                      {{ tag }}
                    </span>
                  }
                </div>
              </div>

              <div class="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <label class="block text-xs font-mono uppercase text-zinc-300 mb-1.5">
                  Hashtags
                </label>
                <div class="flex flex-wrap gap-1.5">
                  @for (hash of proj.youtubeMetadata?.hashtags || []; track hash) {
                    <span class="rounded bg-amber-500/10 px-2 py-1 text-[11px] font-mono text-amber-300">
                      {{ hash }}
                    </span>
                  }
                </div>
              </div>
            </div>
          </div>

          <!-- Right Col: Privacy, COPPA, Playlist & Scheduling -->
          <div class="space-y-4">
            <!-- Privacy Status Picker -->
            <div class="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
              <h3 class="text-xs font-mono uppercase tracking-wider text-zinc-300">
                Visibilidad de Publicación
              </h3>

              <div class="space-y-2">
                <label class="flex items-start gap-2.5 rounded-xl border p-2.5 cursor-pointer text-xs transition-colors"
                  [class.border-amber-500]="privacyStatus() === 'private'"
                  [class.bg-amber-500/10]="privacyStatus() === 'private'"
                  [class.border-zinc-800]="privacyStatus() !== 'private'"
                  [class.bg-zinc-950]="privacyStatus() !== 'private'"
                >
                  <input type="radio" name="privacy" value="private" [checked]="privacyStatus() === 'private'" (change)="setPrivacy('private')" class="mt-0.5 accent-amber-500" />
                  <div>
                    <div class="font-bold text-zinc-200">Privado (Recomendado)</div>
                    <div class="text-[10px] text-zinc-400">Solo tú y las personas que elijas pueden ver el vídeo. Permite revisión previa.</div>
                  </div>
                </label>

                <label class="flex items-start gap-2.5 rounded-xl border p-2.5 cursor-pointer text-xs transition-colors"
                  [class.border-amber-500]="privacyStatus() === 'unlisted'"
                  [class.bg-amber-500/10]="privacyStatus() === 'unlisted'"
                  [class.border-zinc-800]="privacyStatus() !== 'unlisted'"
                  [class.bg-zinc-950]="privacyStatus() !== 'unlisted'"
                >
                  <input type="radio" name="privacy" value="unlisted" [checked]="privacyStatus() === 'unlisted'" (change)="setPrivacy('unlisted')" class="mt-0.5 accent-amber-500" />
                  <div>
                    <div class="font-bold text-zinc-200">Oculto (Unlisted)</div>
                    <div class="text-[10px] text-zinc-400">Cualquiera con el enlace puede verlo. No aparece en búsquedas públicas.</div>
                  </div>
                </label>

                <label class="flex items-start gap-2.5 rounded-xl border p-2.5 cursor-pointer text-xs transition-colors"
                  [class.border-amber-500]="privacyStatus() === 'scheduled'"
                  [class.bg-amber-500/10]="privacyStatus() === 'scheduled'"
                  [class.border-zinc-800]="privacyStatus() !== 'scheduled'"
                  [class.bg-zinc-950]="privacyStatus() !== 'scheduled'"
                >
                  <input type="radio" name="privacy" value="scheduled" [checked]="privacyStatus() === 'scheduled'" (change)="setPrivacy('scheduled')" class="mt-0.5 accent-amber-500" />
                  <div>
                    <div class="font-bold text-zinc-200">Programar Emisión (Scheduled)</div>
                    <div class="text-[10px] text-zinc-400">Se mantendrá privado hasta la fecha y hora seleccionada.</div>
                  </div>
                </label>

                <label class="flex items-start gap-2.5 rounded-xl border p-2.5 cursor-pointer text-xs transition-colors"
                  [class.border-amber-500]="privacyStatus() === 'public'"
                  [class.bg-amber-500/10]="privacyStatus() === 'public'"
                  [class.border-zinc-800]="privacyStatus() !== 'public'"
                  [class.bg-zinc-950]="privacyStatus() !== 'public'"
                >
                  <input type="radio" name="privacy" value="public" [checked]="privacyStatus() === 'public'" (change)="setPrivacy('public')" class="mt-0.5 accent-amber-500" />
                  <div>
                    <div class="font-bold text-zinc-200">Público Inmediato</div>
                    <div class="text-[10px] text-zinc-400">Visible para todo el mundo inmediatamente tras el procesado.</div>
                  </div>
                </label>
              </div>

              <!-- Schedule Date / Time Picker when 'scheduled' -->
              @if (privacyStatus() === 'scheduled') {
                <div class="pt-2 border-t border-zinc-800 space-y-2">
                  <label class="block text-[10px] font-mono uppercase text-zinc-400">Fecha & Hora de Emisión:</label>
                  <div class="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      [value]="scheduleDate()"
                      (change)="updateScheduleDate($event)"
                      class="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
                    />
                    <input
                      type="time"
                      [value]="scheduleTime()"
                      (change)="updateScheduleTime($event)"
                      class="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
                    />
                  </div>
                </div>
              }
            </div>

            <!-- COPPA Made For Kids Confirmation -->
            <div class="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 space-y-2">
              <div class="flex items-center gap-2 text-xs font-bold text-blue-400">
                <mat-icon class="!text-base !w-4 !h-4">child_care</mat-icon>
                <span>Audiencia: Creado para Niños</span>
              </div>
              <p class="text-[11px] text-zinc-400 leading-relaxed">
                Marcado obligatorio conforme a la Ley COPPA. La publicidad personalizada y los comentarios quedan inhabilitados en YouTube.
              </p>
              <div class="flex items-center gap-2 pt-1 font-mono text-[11px] text-emerald-400">
                <mat-icon class="!text-sm !w-4 !h-4">check</mat-icon>
                <span>Made for Kids: SÍ (Verificado)</span>
              </div>
            </div>

            <!-- Playlist Selector -->
            <div class="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-2">
              <label class="block text-xs font-mono uppercase text-zinc-400">Añadir a Lista de Reproducción</label>
              <select class="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none">
                <option value="pl_1">Aventuras en el Bosque de Milo (Temporada 1)</option>
                <option value="pl_2">Cuentos Cortos para Dormir</option>
                <option value="pl_3">Aprender a Compartir (Valores)</option>
              </select>
            </div>
          </div>
        </div>
      }
    </div>
  `
})
export class YouTubeView implements OnInit {
  studio = inject(Studio);

  privacyStatus = signal<'private' | 'unlisted' | 'public' | 'scheduled'>('private');
  scheduleDate = signal<string>('2026-10-06');
  scheduleTime = signal<string>('17:00');
  isPublishing = signal<boolean>(false);
  publishSuccessMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.studio.loadYouTubeStatus();
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('connected') === 'true') {
        this.publishSuccessMessage.set('¡Canal de YouTube conectado y sincronizado exitosamente con Google OAuth 2.0!');
      }
    }
  }

  setPrivacy(status: 'private' | 'unlisted' | 'public' | 'scheduled'): void {
    this.privacyStatus.set(status);
  }

  updateScheduleDate(e: Event): void {
    this.scheduleDate.set((e.target as HTMLInputElement).value);
  }

  updateScheduleTime(e: Event): void {
    this.scheduleTime.set((e.target as HTMLInputElement).value);
  }

  updateTitle(e: Event): void {
    const val = (e.target as HTMLInputElement).value;
    const p = this.studio.activeProject();
    if (p && p.youtubeMetadata) {
      this.studio.updateProject({
        ...p,
        youtubeMetadata: { ...p.youtubeMetadata, title: val }
      });
    }
  }

  updateDescription(e: Event): void {
    const val = (e.target as HTMLTextAreaElement).value;
    const p = this.studio.activeProject();
    if (p && p.youtubeMetadata) {
      this.studio.updateProject({
        ...p,
        youtubeMetadata: { ...p.youtubeMetadata, description: val }
      });
    }
  }

  async regenerateMetadata(): Promise<void> {
    const p = this.studio.activeProject();
    if (!p) return;

    const res = await fetch('/api/generate-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ story: p, language: p.language, channelName: this.studio.channelInfo().channelTitle })
    });
    const data = await res.json();
    if (data.metadata) {
      this.studio.updateProject({
        ...p,
        youtubeMetadata: { ...p.youtubeMetadata, ...data.metadata }
      });
    }
  }

  async executePublish(): Promise<void> {
    this.isPublishing.set(true);
    this.publishSuccessMessage.set(null);

    try {
      const res = await this.studio.publishToYouTube(
        this.privacyStatus(),
        this.privacyStatus() === 'scheduled' ? this.scheduleDate() : undefined,
        this.privacyStatus() === 'scheduled' ? this.scheduleTime() : undefined
      );

      if (res && res.success) {
        this.publishSuccessMessage.set(res.message || 'Vídeo procesado en YouTube exitosamente.');
      }
    } finally {
      this.isPublishing.set(false);
    }
  }
}
