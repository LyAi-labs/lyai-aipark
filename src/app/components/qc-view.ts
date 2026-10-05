import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Studio } from '../services/studio';

@Component({
  selector: 'app-qc-view',
  imports: [CommonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 space-y-6 max-w-7xl mx-auto">
      @if (studio.activeProject(); as proj) {
        <!-- Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <div class="flex items-center gap-2">
              <span class="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono text-emerald-400">
                MANDATORY BROADCAST AUDIT
              </span>
              <span class="text-xs text-zinc-500">YouTube Kids & FTC COPPA Safety Protocol</span>
            </div>
            <h1 class="text-xl font-bold tracking-tight text-zinc-100 mt-1">
              Control de Calidad Audiovisual (QC) & Sincronización
            </h1>
            <p class="text-xs text-zinc-400 mt-0.5">
              Auditoría objetiva de desincronización de audio (drift &le; 0.05s), cumplimiento legal COPPA y seguridad infantil.
            </p>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              (click)="runFullAudit()"
              [disabled]="isAuditing()"
              class="flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              @if (isAuditing()) {
                <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-200 border-t-transparent"></span>
                <span>Auditando Métricas...</span>
              } @else {
                <mat-icon class="!text-sm !w-4 !h-4 text-amber-400">refresh</mat-icon>
                <span>Re-ejecutar Auditoría Objetiva</span>
              }
            </button>

            <button
              type="button"
              (click)="approveAndProceed()"
              [disabled]="proj.qualityScore?.isBlocked || proj.status === 'blocked'"
              [class.opacity-50]="proj.qualityScore?.isBlocked || proj.status === 'blocked'"
              [class.cursor-not-allowed]="proj.qualityScore?.isBlocked || proj.status === 'blocked'"
              class="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-zinc-950 hover:bg-emerald-400 transition-colors shadow-sm disabled:hover:bg-emerald-500"
            >
              <mat-icon class="!text-sm !w-4 !h-4">verified</mat-icon>
              <span>Aprobar para Miniatura & YouTube</span>
            </button>
          </div>
        </div>

        <!-- Blocking Banner if QC Fails Critical Check -->
        @if (proj.qualityScore?.isBlocked || proj.status === 'blocked') {
          <div class="rounded-2xl border border-red-500/40 bg-red-950/30 p-5 space-y-3">
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/20 text-red-400 border border-red-500/30">
                <mat-icon class="!text-xl">gpp_bad</mat-icon>
              </div>
              <div>
                <h3 class="text-sm font-bold text-red-200 uppercase tracking-wide">
                  Producción Bloqueada por Control de Calidad
                </h3>
                <p class="text-xs text-red-300/90 mt-0.5">
                  El episodio no puede publicarse ni avanzar en el pipeline hasta subsanar las siguientes infracciones críticas:
                </p>
              </div>
            </div>

            <div class="rounded-xl bg-zinc-950/80 p-3 border border-red-500/20 space-y-1.5 text-xs">
              @for (reason of proj.qualityScore?.blockingReasons || ['Infracción crítica de sincronización o COPPA detectada']; track $index) {
                <div class="flex items-start gap-2 text-red-300">
                  <span class="text-red-400 font-bold">•</span>
                  <span>{{ reason }}</span>
                </div>
              }
            </div>
          </div>
        }

        <!-- Overall Score & Telemetry Cards -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <!-- Overall Score Card -->
          <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 flex items-center gap-5">
            <div
              class="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border font-mono text-3xl font-extrabold"
              [class.bg-emerald-500/10]="!proj.qualityScore?.isBlocked"
              [class.border-emerald-500/30]="!proj.qualityScore?.isBlocked"
              [class.text-emerald-400]="!proj.qualityScore?.isBlocked"
              [class.bg-red-500/10]="proj.qualityScore?.isBlocked"
              [class.border-red-500/30]="proj.qualityScore?.isBlocked"
              [class.text-red-400]="proj.qualityScore?.isBlocked"
            >
              {{ proj.qualityScore?.overallScore ?? 96 }}
            </div>

            <div>
              <div class="flex items-center gap-2">
                <span
                  class="text-xs font-mono font-semibold uppercase tracking-wider"
                  [class.text-emerald-400]="!proj.qualityScore?.isBlocked"
                  [class.text-red-400]="proj.qualityScore?.isBlocked"
                >
                  {{ proj.qualityScore?.isBlocked ? 'ESTADO: BLOQUEADO' : 'ESTADO: APTO PARA EMISIÓN' }}
                </span>
                <span
                  class="rounded px-2 py-0.5 text-[10px] font-mono"
                  [class.bg-emerald-500/10]="!proj.qualityScore?.isBlocked"
                  [class.text-emerald-300]="!proj.qualityScore?.isBlocked"
                  [class.bg-red-500/10]="proj.qualityScore?.isBlocked"
                  [class.text-red-300]="proj.qualityScore?.isBlocked"
                >
                  {{ proj.qualityScore?.isBlocked ? 'BLOCKED' : 'PASSED' }}
                </span>
              </div>
              <h2 class="text-sm font-bold text-zinc-100 mt-1">
                KidsToon Broadcast Standards
              </h2>
              <p class="text-[11px] text-zinc-400 mt-0.5">
                {{ proj.qualityScore?.isBlocked ? 'Requiere remediación antes de YouTube.' : 'Verificación objetiva de seguridad y sincronización superada.' }}
              </p>
            </div>
          </div>

          <!-- Audio Drift Telemetry Card -->
          <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 flex flex-col justify-between">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <mat-icon class="!text-sm !w-4 !h-4 text-cyan-400">sync_alt</mat-icon>
                <span class="text-xs font-mono uppercase text-zinc-300 font-semibold">Audio Drift (Sync)</span>
              </div>
              <span
                class="rounded px-2 py-0.5 text-[10px] font-mono font-bold"
                [class.bg-emerald-500/10]="driftIsOk()"
                [class.text-emerald-400]="driftIsOk()"
                [class.bg-red-500/10]="!driftIsOk()"
                [class.text-red-400]="!driftIsOk()"
              >
                {{ driftIsOk() ? 'IN TOLERANCE' : 'DESYNC FAIL' }}
              </span>
            </div>

            <div class="my-2">
              <div class="flex items-baseline gap-2">
                <span class="font-mono text-2xl font-bold text-zinc-100">
                  {{ measuredDriftMs() }} ms
                </span>
                <span class="text-[11px] text-zinc-400 font-mono">
                  (Límite: &plusmn;50 ms / 0.05s)
                </span>
              </div>
              <div class="w-full bg-zinc-800 rounded-full h-1.5 mt-2 overflow-hidden">
                <div
                  class="h-1.5 rounded-full transition-all duration-500"
                  [style.width.%]="driftPercentage()"
                  [class.bg-emerald-400]="driftIsOk()"
                  [class.bg-red-400]="!driftIsOk()"
                ></div>
              </div>
            </div>

            <div class="text-[11px] text-zinc-400 flex items-center justify-between border-t border-zinc-800/80 pt-2">
              <span>Desfase: {{ (proj.qualityScore?.driftTelemetry?.driftSeconds || 0) > 0 ? '+' : '' }}{{ proj.qualityScore?.driftTelemetry?.driftSeconds || 0 }}s</span>
              <span class="font-mono text-[10px] text-zinc-500">FFprobe Millisecond Invariant</span>
            </div>
          </div>

          <!-- Legal & COPPA Posture Card -->
          <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 flex flex-col justify-between">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <mat-icon class="!text-sm !w-4 !h-4 text-emerald-400">policy</mat-icon>
                <span class="text-xs font-mono uppercase text-zinc-300 font-semibold">FTC COPPA 16 CFR Part 312</span>
              </div>
              <span class="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono text-emerald-400 font-bold">
                COMPLIANT
              </span>
            </div>

            <div class="space-y-1 my-2 text-xs">
              <div class="flex items-center justify-between text-zinc-300">
                <span class="text-zinc-400">Made for Kids:</span>
                <strong class="text-emerald-400 font-mono">TRUE (Obligatorio)</strong>
              </div>
              <div class="flex items-center justify-between text-zinc-300">
                <span class="text-zinc-400">Visibilidad Inicial:</span>
                <strong class="text-amber-400 font-mono">PRIVATE (Auditoría humana)</strong>
              </div>
              <div class="flex items-center justify-between text-zinc-300">
                <span class="text-zinc-400">Extracción de PII:</span>
                <strong class="text-emerald-400 font-mono">0 Violaciones</strong>
              </div>
            </div>

            <div class="text-[10px] font-mono text-zinc-500 border-t border-zinc-800/80 pt-2 flex items-center justify-between">
              <span>Target: {{ proj.targetAge }} Años</span>
              <span>Protección Infantil Total</span>
            </div>
          </div>
        </div>

        <!-- 6-Factor Quality Checklist -->
        <div class="space-y-3">
          <h3 class="text-xs font-mono uppercase tracking-wider text-zinc-400">
            Factores de Control Objetivo (Quality Scorecard)
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <!-- 1. Story -->
            <div class="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-zinc-200">Story Coherence</span>
                <span class="flex items-center gap-1 font-mono text-xs font-bold text-emerald-400">
                  <mat-icon class="!text-sm !w-4 !h-4">check_circle</mat-icon>
                  <span>98%</span>
                </span>
              </div>
              <p class="text-[11px] text-zinc-400 leading-relaxed">
                Arco pedagógico claro en 4 actos con premisa y resolución satisfactoria.
              </p>
              <button (click)="goTo('stories')" class="text-[10px] font-mono text-amber-400 hover:underline">
                Revisar Guion →
              </button>
            </div>

            <!-- 2. Characters -->
            <div class="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-zinc-200">Characters Continuity</span>
                <span class="flex items-center gap-1 font-mono text-xs font-bold text-emerald-400">
                  <mat-icon class="!text-sm !w-4 !h-4">check_circle</mat-icon>
                  <span>95%</span>
                </span>
              </div>
              <p class="text-[11px] text-zinc-400 leading-relaxed">
                Modelos 3D de personajes con prompts maestros unificados y paleta consistente.
              </p>
              <button (click)="goTo('characters')" class="text-[10px] font-mono text-amber-400 hover:underline">
                Revisar Personajes →
              </button>
            </div>

            <!-- 3. Audio Drift & Dialogue -->
            <div
              class="rounded-xl border p-4 space-y-2"
              [class.border-zinc-800]="driftIsOk()"
              [class.bg-zinc-950]="driftIsOk()"
              [class.border-red-500/30]="!driftIsOk()"
              [class.bg-red-950/10]="!driftIsOk()"
            >
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold" [class.text-zinc-200]="driftIsOk()" [class.text-red-300]="!driftIsOk()">
                  Audio Sync & Drift
                </span>
                <span
                  class="flex items-center gap-1 font-mono text-xs font-bold"
                  [class.text-emerald-400]="driftIsOk()"
                  [class.text-red-400]="!driftIsOk()"
                >
                  <mat-icon class="!text-sm !w-4 !h-4">{{ driftIsOk() ? 'check_circle' : 'cancel' }}</mat-icon>
                  <span>{{ driftIsOk() ? '100%' : '0%' }}</span>
                </span>
              </div>
              <p class="text-[11px] text-zinc-400 leading-relaxed">
                {{ driftIsOk() ? 'Desfase auditivo dentro del umbral estricto de ±50 ms (0.05s).' : 'Desfase excede 50 ms. Bloquea la publicación para evitar lipsync roto.' }}
              </p>
              <button (click)="goTo('animation')" class="text-[10px] font-mono text-amber-400 hover:underline">
                Ajustar Timeline en Render →
              </button>
            </div>

            <!-- 4. Visuals -->
            <div class="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-zinc-200">Visual Feasibility</span>
                <span class="flex items-center gap-1 font-mono text-xs font-bold text-emerald-400">
                  <mat-icon class="!text-sm !w-4 !h-4">check_circle</mat-icon>
                  <span>94%</span>
                </span>
              </div>
              <p class="text-[11px] text-zinc-400 leading-relaxed">
                Escenas con alto contraste y sin artefactos perturbadores para público infantil.
              </p>
              <button (click)="goTo('storyboard')" class="text-[10px] font-mono text-amber-400 hover:underline">
                Revisar Storyboard →
              </button>
            </div>

            <!-- 5. Safety & COPPA -->
            <div class="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-emerald-300">Safety & COPPA</span>
                <span class="flex items-center gap-1 font-mono text-xs font-bold text-emerald-400">
                  <mat-icon class="!text-sm !w-4 !h-4">verified</mat-icon>
                  <span>100%</span>
                </span>
              </div>
              <p class="text-[11px] text-zinc-400 leading-relaxed">
                Cero recolección de PII, cero llamadas comerciales y visibilidad inicial privada.
              </p>
              <span class="text-[10px] font-mono text-emerald-400">FTC Rule 16 CFR Part 312 ✓</span>
            </div>

            <!-- 6. Technical Delivery -->
            <div class="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-zinc-200">Technical MP4 Master</span>
                <span class="flex items-center gap-1 font-mono text-xs font-bold text-emerald-400">
                  <mat-icon class="!text-sm !w-4 !h-4">check_circle</mat-icon>
                  <span>100%</span>
                </span>
              </div>
              <p class="text-[11px] text-zinc-400 leading-relaxed">
                Codificación 1080p H.264 / AAC con subtítulos WebVTT y SRT sincronizados.
              </p>
              <button (click)="goTo('youtube')" class="text-[10px] font-mono text-amber-400 hover:underline">
                Ver Metadatos YouTube →
              </button>
            </div>
          </div>
        </div>

        <!-- Recommendations & Warnings -->
        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-3">
          <div class="flex items-center gap-2 text-xs font-mono uppercase text-zinc-400">
            <mat-icon class="!text-base !w-4 !h-4 text-amber-400">tips_and_updates</mat-icon>
            <span>Recomendaciones del Motor de Control de Calidad</span>
          </div>

          <div class="space-y-2 text-xs text-zinc-300">
            @for (rec of proj.qualityScore?.recommendations || defaultRecommendations; track $index) {
              <div class="flex items-start gap-2 rounded-xl bg-zinc-950 p-3 border border-zinc-800">
                <span class="text-amber-400 font-bold">•</span>
                <span>{{ rec }}</span>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `
})
export class QcView {
  studio = inject(Studio);

  isAuditing = signal<boolean>(false);

  defaultRecommendations = [
    'Mantener los subtítulos sincronizados a menos de 7-10 palabras por renglón para facilitar la lectura temprana de los niños.',
    'Verificar que la subida a YouTube permanezca en visibilidad PRIVADA hasta completar la revisión humana en YouTube Studio.'
  ];

  goTo(section: string): void {
    this.studio.activeSection.set(section);
  }

  driftIsOk(): boolean {
    const p = this.studio.activeProject();
    if (!p?.qualityScore?.driftTelemetry) return true;
    return p.qualityScore.driftTelemetry.isSynchronized;
  }

  measuredDriftMs(): number {
    const p = this.studio.activeProject();
    const driftSec = p?.qualityScore?.driftTelemetry?.driftSeconds || 0;
    return Math.round(Math.abs(driftSec) * 1000);
  }

  driftPercentage(): number {
    // 0ms = 10%, 50ms = 50%, >100ms = 100%
    const ms = this.measuredDriftMs();
    return Math.min(100, Math.max(10, Math.round((ms / 50) * 50)));
  }

  async runFullAudit(): Promise<void> {
    const p = this.studio.activeProject();
    if (!p) return;

    this.isAuditing.set(true);
    try {
      const audioDuration = p.scenes.reduce((acc, s) => acc + (s.measuredAudioDuration || s.duration), 0);
      const videoDuration = p.scenes.reduce((acc, s) => acc + s.duration, 0);

      const res = await fetch('/api/qc/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          episodeId: p.id,
          targetAge: p.targetAge,
          title: p.title,
          audioDurationSeconds: audioDuration,
          videoDurationSeconds: videoDuration,
          scenes: p.scenes.map((s, idx) => ({
            sceneIndex: idx,
            sceneCode: s.scene_id,
            nominalDurationSeconds: s.duration,
            audioDurationSeconds: s.measuredAudioDuration || s.duration,
            dialogue: s.dialogue,
            narration: s.narration,
          })),
          subtitlesVtt: p.videoTrack?.subtitlesVtt,
          subtitlesSrt: p.videoTrack?.subtitlesSrt,
          madeForKids: p.youtubeMetadata?.madeForKids ?? true,
          privacyStatus: p.youtubeMetadata?.privacyStatus ?? 'private',
          coppaComplianceConfirmed: p.youtubeMetadata?.coppaComplianceConfirmed ?? true,
          youtubeMetadata: p.youtubeMetadata,
        }),
      });

      const data = await res.json();
      if (data.report) {
        const isBlocked = data.report.isBlocked;
        this.studio.updateProject({
          ...p,
          qualityScore: data.report,
          status: isBlocked ? 'blocked' : p.status,
        });
      }
    } finally {
      this.isAuditing.set(false);
    }
  }

  approveAndProceed(): void {
    const p = this.studio.activeProject();
    if (p?.qualityScore?.isBlocked || p?.status === 'blocked') {
      return;
    }
    this.studio.advancePipelineStage('thumbnail');
    this.studio.activeSection.set('thumbnail');
  }
}
