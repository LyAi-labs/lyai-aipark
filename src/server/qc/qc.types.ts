/**
 * Cartoon Studio — Objective Quality Control (QC) Types
 * Phase 09: Objective Quality Control (Audio Drift & COPPA Checks)
 *
 * Defines canonical data contracts, rule categories, severity levels,
 * drift thresholds, and COPPA compliance invariants.
 */

export type QCCategory =
  | 'SAFETY_COMPLIANCE'
  | 'CONTENT'
  | 'CONTINUITY'
  | 'AUDIO'
  | 'VISUAL'
  | 'TECHNICAL';

export type QCSeverity = 'CRITICAL' | 'WARNING';

export type QCCheckStatus = 'PASS' | 'WARNING' | 'FAIL';

export type AuditorType =
  | 'DETERMINISTIC_ENGINE'
  | 'AI_ENGINE'
  | 'HYBRID_ENGINE'
  | 'HUMAN_SUPERVISOR';

export interface QCCheckResult {
  ruleCode: string;
  category: QCCategory;
  severity: QCSeverity;
  status: QCCheckStatus;
  score: number; // 0 to 100
  notes: string;
  remediation?: string;
  telemetry?: Record<string, unknown>;
}

export interface QCReportSummary {
  id: string;
  episodeId: string;
  episodeVersionId?: string;
  overallScore: number; // 0 to 100
  approvedForProduction: boolean;
  isBlocked: boolean;
  blockingReasons: string[];
  auditorType: AuditorType;
  auditorModel: string;
  auditedAt: string;
  checks: QCCheckResult[];
  categories: Record<string, {
    score: number;
    status: QCCheckStatus;
    notes: string;
  }>;
  recommendations: string[];
  flags: string[];
  driftTelemetry?: {
    audioDurationSeconds: number;
    videoDurationSeconds: number;
    driftSeconds: number;
    maxAllowedDriftSeconds: number;
    isSynchronized: boolean;
  };
}

export interface SceneDriftInfo {
  sceneIndex: number;
  sceneCode: string;
  nominalDurationSeconds: number;
  audioDurationSeconds: number;
  driftSeconds: number;
  isWithinTolerance: boolean;
}

export interface MediaProbeResult {
  durationSeconds: number;
  videoDurationSeconds?: number;
  audioDurationSeconds?: number;
  driftSeconds?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  isWithinTolerance: boolean;
}

export interface AudioDriftAuditInput {
  audioDurationSeconds: number;
  videoDurationSeconds: number;
  maxToleranceSeconds?: number; // default: 0.05s (50ms)
}

export interface SceneTimelineAuditInput {
  scenes: Array<{
    sceneIndex?: number;
    sceneCode?: string;
    nominalDurationSeconds: number;
    audioDurationSeconds: number;
  }>;
  maxToleranceSeconds?: number; // default: 0.05s
}

export interface CoppaAuditInput {
  targetAge: string;
  title: string;
  dialogueTexts?: string[];
  narrationTexts?: string[];
  educationalObjective?: string;
  madeForKids?: boolean;
  privacyStatus?: string;
  coppaComplianceConfirmed?: boolean;
  youtubeMetadata?: {
    title?: string;
    description?: string;
    tags?: string[];
    madeForKids?: boolean;
    privacyStatus?: string;
  };
}

export interface FullEpisodeAuditInput {
  episodeId: string;
  episodeVersionId?: string;
  targetAge: string;
  title: string;
  audioDurationSeconds?: number;
  videoDurationSeconds?: number;
  videoFilePath?: string;
  audioFilePath?: string;
  scenes?: Array<{
    sceneIndex?: number;
    sceneCode?: string;
    nominalDurationSeconds: number;
    audioDurationSeconds?: number;
    dialogue?: string;
    narration?: string;
    text?: string;
  }>;
  subtitlesVtt?: string;
  subtitlesSrt?: string;
  madeForKids?: boolean;
  privacyStatus?: string;
  coppaComplianceConfirmed?: boolean;
  youtubeMetadata?: {
    title?: string;
    description?: string;
    tags?: string[];
    madeForKids?: boolean;
    privacyStatus?: string;
  };
}
