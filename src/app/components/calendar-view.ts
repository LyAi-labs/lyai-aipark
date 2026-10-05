import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Studio } from '../services/studio';
import { EditorialCalendarItem } from '../models/studio.models';

@Component({
  selector: 'app-calendar-view',
  imports: [CommonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 space-y-6 max-w-7xl mx-auto">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <div class="flex items-center gap-2">
            <span class="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono text-amber-300">EDITORIAL PIPELINE</span>
            <span class="text-xs text-zinc-500">Planificador de Emisiones YouTube</span>
          </div>
          <h1 class="text-xl font-bold tracking-tight text-zinc-100 mt-1">
            Calendario Editorial de Publicaciones
          </h1>
          <p class="text-xs text-zinc-400 mt-0.5">
            Programa, reprograma y mantén una cadencia consistente de estrenos infantiles.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <!-- Scheduler Daemon Status Badge -->
          <div class="flex items-center gap-2 rounded-xl border border-emerald-900/60 bg-emerald-950/40 px-3 py-1.5 font-mono text-xs text-emerald-400">
            <span class="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>DAEMON SCHEDULER ACTIVO</span>
          </div>

          <button
            type="button"
            (click)="triggerScheduler()"
            [disabled]="isTriggering()"
            class="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 font-mono text-xs text-amber-300 font-semibold transition-all disabled:opacity-50"
          >
            <mat-icon class="!text-sm !w-4 !h-4 text-amber-400">sync</mat-icon>
            <span>{{ isTriggering() ? 'Comprobando...' : 'Revisar Ahora' }}</span>
          </button>

          <div class="flex items-center rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-300">
            <mat-icon class="!text-sm !w-4 !h-4 text-amber-400 mr-2">calendar_today</mat-icon>
            <span>OCTUBRE 2026</span>
          </div>
        </div>
      </div>

      <!-- Calendar Month Grid: October 2026 -->
      <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
        <!-- Weekday Headers -->
        <div class="grid grid-cols-7 gap-2 text-center font-mono text-xs font-semibold text-zinc-500 border-b border-zinc-800 pb-2">
          <span>LUN (MON)</span>
          <span>MAR (TUE)</span>
          <span>MIÉ (WED)</span>
          <span>JUE (THU)</span>
          <span>VIE (FRI)</span>
          <span>SÁB (SAT)</span>
          <span>DOM (SUN)</span>
        </div>

        <!-- Days Grid -->
        <div class="grid grid-cols-7 gap-2">
          @for (cell of calendarDays; track cell.dayNumber) {
            <div
              class="min-h-[110px] rounded-xl border p-2 flex flex-col justify-between transition-colors"
              [class.border-zinc-800]="!cell.isToday"
              [class.bg-zinc-950/70]="!cell.isToday"
              [class.border-amber-500/50]="cell.isToday"
              [class.bg-amber-500/5]="cell.isToday"
            >
              <div class="flex items-center justify-between text-xs font-mono">
                <span [class.text-amber-400]="cell.isToday" [class.font-bold]="cell.isToday" [class.text-zinc-500]="!cell.isToday">
                  {{ cell.dayNumber }}
                </span>
                @if (cell.isToday) {
                  <span class="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300 font-bold">HOY</span>
                }
              </div>

              <!-- Scheduled Episodes in this day -->
              <div class="space-y-1.5 my-1">
                @for (ep of getEpisodesForDay(cell.dateString); track ep.id) {
                  <div
                    class="rounded-lg border px-2 py-1.5 text-[10px] space-y-0.5 cursor-pointer transition-all"
                    [class.border-emerald-500/40]="ep.status === 'scheduled'"
                    [class.bg-emerald-950/40]="ep.status === 'scheduled'"
                    [class.text-emerald-200]="ep.status === 'scheduled'"
                    [class.border-zinc-700]="ep.status === 'draft'"
                    [class.bg-zinc-800/80]="ep.status === 'draft'"
                    [class.text-zinc-300]="ep.status === 'draft'"
                  >
                    <div class="flex items-center justify-between font-mono font-bold">
                      <span>{{ ep.episodeCode }}</span>
                      <span class="text-[9px] opacity-80">{{ ep.scheduledTime }}</span>
                    </div>
                    <div class="truncate font-semibold">{{ ep.title }}</div>
                    <div class="flex items-center justify-between text-[9px] opacity-70">
                      <span>{{ ep.privacyStatus | uppercase }}</span>
                      <span>{{ ep.status }}</span>
                    </div>
                  </div>
                }
              </div>

              <div class="text-[10px] text-zinc-600 text-right">
                <!-- spacer -->
              </div>
            </div>
          }
        </div>
      </div>

      <!-- Scheduled List Management Table -->
      <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
        <h3 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
          <mat-icon class="!text-base !w-4 !h-4 text-amber-400">schedule</mat-icon>
          <span>Listado de Publicaciones Programadas</span>
        </h3>

        <div class="divide-y divide-zinc-800 text-xs">
          @for (item of studio.calendarItems(); track item.id) {
            <div class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                <span class="rounded bg-amber-500 px-2 py-0.5 font-mono text-[10px] font-bold text-zinc-950">
                  {{ item.episodeCode }}
                </span>
                <div>
                  <div class="font-bold text-zinc-200">{{ item.title }}</div>
                  <div class="text-[11px] text-zinc-500 font-mono mt-0.5">
                    Fecha: {{ item.scheduledDate }} · Hora: {{ item.scheduledTime }} · Visibilidad: {{ item.privacyStatus | uppercase }}
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-2">
                <button
                  type="button"
                  (click)="duplicateItem(item)"
                  class="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Duplicar
                </button>
                <button
                  type="button"
                  (click)="cancelItem(item.id)"
                  class="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-rose-400 hover:bg-rose-500/10"
                >
                  Cancelar
                </button>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `
})
export class CalendarView implements OnInit {
  studio = inject(Studio);
  isTriggering = signal<boolean>(false);

  ngOnInit(): void {
    this.studio.loadSchedulerStatus();
  }

  async triggerScheduler(): Promise<void> {
    this.isTriggering.set(true);
    try {
      await this.studio.triggerSchedulerNow();
    } finally {
      this.isTriggering.set(false);
    }
  }

  // October 2026 days representation
  calendarDays = Array.from({ length: 31 }, (_, i) => {
    const day = i + 1;
    const dayStr = day < 10 ? '0' + day : '' + day;
    return {
      dayNumber: day,
      dateString: `2026-10-${dayStr}`,
      isToday: day === 2 // October 2nd, 2026
    };
  });

  getEpisodesForDay(dateStr: string): EditorialCalendarItem[] {
    return this.studio.calendarItems().filter(c => c.scheduledDate === dateStr);
  }

  duplicateItem(item: EditorialCalendarItem): void {
    const newItem: EditorialCalendarItem = {
      ...item,
      id: 'cal_' + Date.now().toString(36),
      episodeCode: `EP0${this.studio.calendarItems().length + 1}`,
      title: `${item.title} (Re-emisión)`,
      scheduledDate: '2026-10-20'
    };
    this.studio.calendarItems.update(list => [...list, newItem]);
  }

  cancelItem(id: string): void {
    this.studio.calendarItems.update(list => list.filter(item => item.id !== id));
  }
}
