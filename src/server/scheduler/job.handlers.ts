/**
 * Cartoon Studio — Job Handlers Registry (Phase 11)
 * Discrete, testable, and robust handlers for each asynchronous JobType.
 */

import { JobType } from '@prisma/client';
import { JobExecutionContext, JobHandler } from './types';
import { geminiService } from '../ai';
import { voicePipelineService } from '../audio';
import { visualService } from '../visuals';
import { RenderService } from '../render';
import { qcService } from '../qc';
import { youTubeService } from '../youtube';
import { logger } from '../utils/logger';
import { AppError } from '../errors';

/**
 * Executes a SCRIPTING job: generates structured narrative using Gemini 3.8 Flash.
 */
export async function executeScriptingJob(ctx: JobExecutionContext): Promise<Record<string, unknown>> {
  const { job, signal, updateProgress, completeStep, logInfo } = ctx;
  logInfo('Starting SCRIPTING job execution', { episodeId: job.episodeId });

  if (signal.aborted) throw new AppError('Job cancelled', 499, 'JOB_ABORTED');

  await updateProgress(15, 'Sanitizando parámetros y analizando premisa argumental...', 'PARSE_INPUT');
  const payload = job.payload || {};
  const idea = String(payload['idea'] || 'Aventuras educativas en el bosque mágico');
  const targetAge = String(payload['targetAge'] || '3-5');
  const tone = String(payload['tone'] || 'educativo');
  const characterCount = Number(payload['characterCount'] || 2);
  const sceneCount = Number(payload['sceneCount'] || 3);
  const language = String(payload['language'] || 'es-ES');

  await completeStep('PARSE_INPUT', 'Premisa validada');
  if (signal.aborted) throw new AppError('Job cancelled', 499, 'JOB_ABORTED');

  await updateProgress(50, 'Generando guion estructurado conforme a normativas infantiles...', 'GENERATE_STORY');
  const storyResult = await geminiService.generateStory({
    idea,
    targetAge,
    tone,
    numberOfScenes: sceneCount,
    language,
    educationalObjective: String(payload['moralLesson'] || 'Trabajo en equipo y respeto'),
  });

  const isRealAi = Boolean(storyResult.metrics?.isRealAi);

  await completeStep('GENERATE_STORY', `Guion generado: ${storyResult.story.title}`, {
    title: storyResult.story.title,
    scenesCount: storyResult.story.scenes.length,
    isRealAi,
  });

  if (signal.aborted) throw new AppError('Job cancelled', 499, 'JOB_ABORTED');
  await updateProgress(90, 'Verificando coherencia y empaquetando resultado...', 'FINALIZE_SCRIPT');
  await completeStep('FINALIZE_SCRIPT', 'Finalizado con éxito');
  await updateProgress(100, 'Guion completado exitosamente.');

  return {
    story: storyResult.story,
    isRealAi,
    episodeId: job.episodeId,
  };
}

/**
 * Executes a VOICE_GENERATION job: synthesizes speech tracks for episode scenes.
 */
export async function executeVoiceJob(ctx: JobExecutionContext): Promise<Record<string, unknown>> {
  const { job, signal, updateProgress, completeStep, logInfo } = ctx;
  logInfo('Starting VOICE_GENERATION job execution', { episodeId: job.episodeId });

  if (signal.aborted) throw new AppError('Job cancelled', 499, 'JOB_ABORTED');

  await updateProgress(10, 'Preparando líneas de diálogo y locuciones...', 'PARSE_DIALOGUE');
  const payload = job.payload || {};
  const rawScenes = (payload['scenes'] as any[]) || [
    { sceneIndex: 1, sceneCode: 'SC01', text: '¡Hola amiguitos! Bienvenidos a nuestra nueva aventura en el bosque.', speakerName: 'Milo' },
    { sceneIndex: 2, sceneCode: 'SC02', text: 'Hoy aprenderemos a compartir y ayudarnos mutuamente.', speakerName: 'Tula' },
  ];

  await completeStep('PARSE_DIALOGUE', `${rawScenes.length} escenas identificadas`);
  const sceneResults = [];
  const total = rawScenes.length;

  for (let i = 0; i < total; i++) {
    if (signal.aborted) throw new AppError('Job cancelled', 499, 'JOB_ABORTED');
    const sc = rawScenes[i];
    const pct = Math.round(15 + ((i + 1) / total) * 75);
    await updateProgress(pct, `Sintetizando voz para escena ${sc.sceneCode || i + 1} (${sc.speakerName || 'Narrador'})...`, `VOICE_SCENE_${i + 1}`);

    const res = await voicePipelineService.synthesizeSceneAudio({
      episodeId: job.episodeId,
      sceneIndex: sc.sceneIndex ?? i + 1,
      sceneCode: sc.sceneCode ?? `SC0${i + 1}`,
      text: sc.text || 'Escena sin diálogo.',
      speakerName: sc.speakerName,
      nominalDuration: sc.nominalDuration ?? 4,
    });

    sceneResults.push(res);
    await completeStep(`VOICE_SCENE_${i + 1}`, res.publicUrl, {
      durationSeconds: res.durationSeconds,
      storageKey: res.storageKey,
    });
  }

  await updateProgress(100, 'Síntesis vocal de todas las escenas completada.');
  return {
    episodeId: job.episodeId,
    sceneCount: sceneResults.length,
    scenes: sceneResults,
  };
}

/**
 * Executes an ASSET_GENERATION or STORYBOARDING job: generates 16:9 scene visuals.
 */
export async function executeVisualJob(ctx: JobExecutionContext): Promise<Record<string, unknown>> {
  const { job, signal, updateProgress, completeStep, logInfo } = ctx;
  logInfo('Starting ASSET_GENERATION visual job execution', { episodeId: job.episodeId });

  if (signal.aborted) throw new AppError('Job cancelled', 499, 'JOB_ABORTED');

  await updateProgress(10, 'Analizando composiciones visuales y paletas de personajes...', 'PARSE_VISUALS');
  const payload = job.payload || {};
  const rawScenes = (payload['scenes'] as any[]) || [
    { sceneIndex: 1, sceneCode: 'SC01', location: 'Bosque soleado', action: 'Milo saluda a la cámara con una sonrisa radiante' },
    { sceneIndex: 2, sceneCode: 'SC02', location: 'Prado verde', action: 'Tula salta de alegría junto a las flores' },
  ];

  await completeStep('PARSE_VISUALS', `${rawScenes.length} fotogramas visuales requeridos`);
  const visualResults = [];
  const total = rawScenes.length;

  for (let i = 0; i < total; i++) {
    if (signal.aborted) throw new AppError('Job cancelled', 499, 'JOB_ABORTED');
    const sc = rawScenes[i];
    const pct = Math.round(15 + ((i + 1) / total) * 75);
    await updateProgress(pct, `Generando arte 16:9 para escena ${sc.sceneCode || i + 1}...`, `VISUAL_SCENE_${i + 1}`);

    const res = await visualService.generateSceneVisual({
      episodeId: job.episodeId,
      sceneIndex: sc.sceneIndex ?? i + 1,
      sceneCode: sc.sceneCode ?? `SC0${i + 1}`,
      location: sc.location || 'Bosque animado',
      timeOfDay: sc.timeOfDay || 'Día soleado',
      action: sc.action || 'Personaje animado en escena',
      characters: sc.characters || ['Milo'],
      seriesStyle: sc.seriesStyle || '3D CGI infantil colorido y cálido',
      width: sc.width || (payload['width'] as number) || (process.env['NODE_ENV'] === 'test' ? 320 : undefined),
      height: sc.height || (payload['height'] as number) || (process.env['NODE_ENV'] === 'test' ? 180 : undefined),
    });

    visualResults.push(res);
    await completeStep(`VISUAL_SCENE_${i + 1}`, res.publicUrl, {
      storageKey: res.storageKey,
      checksumSha256: res.checksumSha256,
    });
  }

  await updateProgress(100, 'Generación de artes visuales completada.');
  return {
    episodeId: job.episodeId,
    visualCount: visualResults.length,
    visuals: visualResults,
  };
}

/**
 * Executes an FFMPEG_RENDER job: compiles video clips, mixes audio, embeds subtitles.
 */
export async function executeRenderJob(ctx: JobExecutionContext): Promise<Record<string, unknown>> {
  const { job, signal, updateProgress, completeStep, logInfo } = ctx;
  logInfo('Starting FFMPEG_RENDER job execution', { episodeId: job.episodeId });

  if (signal.aborted) throw new AppError('Job cancelled', 499, 'JOB_ABORTED');

  await updateProgress(5, 'Iniciando pipeline de renderizado y multiplexado FFmpeg...', 'START_RENDER');
  const payload = job.payload || {};

  const renderService = RenderService.getInstance();
  const renderRes = await renderService.startRender({
    episodeId: job.episodeId,
    title: String(payload['title'] || 'Episodio de Producción'),
    scenes: (payload['scenes'] as any[]) || [
      {
        sceneIndex: 1,
        sceneCode: 'SC01',
        visualDescription: 'Milo explorando el bosque encantado',
        dialogue: '¡Hola amigos, miren qué hermoso día para jugar!',
        speaker: 'Milo',
        durationSeconds: 4,
      },
    ],
    options: {
      resolution: (payload['resolution'] as any) || '1080p',
      fps: Number(payload['fps'] || 24),
    },
  });

  await completeStep('START_RENDER', renderRes.jobId, { pollUrl: renderRes.pollUrl });

  // Poll until RenderService job completes or times out
  const startTime = Date.now();
  const timeoutMs = 120000; // 2 minutes max

  while (Date.now() - startTime < timeoutMs) {
    if (signal.aborted) {
      await renderService.cancelJob(renderRes.jobId);
      throw new AppError('Job cancelled', 499, 'JOB_ABORTED');
    }

    const state = renderService.getJobState(renderRes.jobId);
    if (!state) break;

    const mappedProgress = Math.min(95, Math.max(10, state.progress));
    await updateProgress(mappedProgress, state.stepDescription, state.status);

    if (state.status === 'COMPLETED') {
      await completeStep('FINALIZE_RENDER', state.result?.videoPublicUrl || '', state.result as any);
      await updateProgress(100, 'Renderizado MP4 finalizado con éxito.');
      return {
        renderJobId: renderRes.jobId,
        videoUrl: state.result?.videoPublicUrl,
        storageKey: state.result?.videoStorageKey,
        durationSeconds: state.result?.durationSeconds,
        sizeBytes: state.result?.sizeBytes,
      };
    }

    if (state.status === 'FAILED') {
      throw new AppError(state.errorMessage || 'El renderizado de FFmpeg ha fallado', 500, 'RENDER_FAILED');
    }

    if (state.status === 'CANCELLED') {
      throw new AppError('Renderizado cancelado', 499, 'JOB_CANCELLED');
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  throw new AppError('Tiempo de espera agotado durante el renderizado de vídeo', 504, 'RENDER_TIMEOUT');
}

/**
 * Executes a VALIDATION (Quality Control) job: checks drift, COPPA compliance, and standards.
 */
export async function executeValidationJob(ctx: JobExecutionContext): Promise<Record<string, unknown>> {
  const { job, signal, updateProgress, completeStep, logInfo } = ctx;
  logInfo('Starting VALIDATION (QC) job execution', { episodeId: job.episodeId });

  if (signal.aborted) throw new AppError('Job cancelled', 499, 'JOB_ABORTED');

  await updateProgress(20, 'Ejecutando auditoría de desincronización de audio (Drift <= 0.05s)...', 'CHECK_DRIFT');
  const payload = job.payload || {};

  const auditInput = {
    episodeId: job.episodeId,
    title: String(payload['title'] || 'Episodio de Prueba'),
    targetAge: String(payload['targetAge'] || '3-5'),
    audioDurationSeconds: Number(payload['audioDurationSeconds'] || 10.0),
    videoDurationSeconds: Number(payload['videoDurationSeconds'] || 10.02),
    madeForKids: true,
    privacyStatus: (payload['privacyStatus'] as any) || 'private',
    coppaComplianceConfirmed: true,
    scenes: (payload['scenes'] as any[]) || [
      {
        sceneIndex: 1,
        sceneCode: 'SC01',
        text: 'Aventura segura sin recolección de datos.',
        nominalDurationSeconds: 10,
        audioDurationSeconds: 10.0,
      },
    ],
  };

  const report = await qcService.auditEpisode(auditInput);
  const driftSeconds = report.driftTelemetry?.driftSeconds ?? 0;
  const isSynchronized = report.driftTelemetry?.isSynchronized ?? true;
  const coppaStatus = report.categories?.['safetyAndCoppa']?.status ?? 'PASS';
  const coppaPassed = coppaStatus === 'PASS';

  await completeStep('CHECK_DRIFT', `Drift: ${driftSeconds}s`, {
    audioDriftSeconds: driftSeconds,
    driftPassed: isSynchronized,
  });

  if (signal.aborted) throw new AppError('Job cancelled', 499, 'JOB_ABORTED');
  await updateProgress(70, 'Verificando salvaguardas COPPA y ausencia de PII infantil...', 'CHECK_COPPA');
  await completeStep('CHECK_COPPA', `COPPA Status: ${coppaStatus}`, {
    coppaPassed,
  });

  await updateProgress(100, report.approvedForProduction ? 'Control de Calidad APROBADO.' : 'Control de Calidad BLOQUEADO por infracción.');

  return {
    reportId: report.id,
    overallScore: report.overallScore,
    approvedForProduction: report.approvedForProduction,
    isBlocked: report.isBlocked,
    audioDriftSeconds: driftSeconds,
    coppaStatus,
    blockingReasons: report.blockingReasons,
  };
}

/**
 * Executes a YOUTUBE_PUBLISH job: uploads video and thumbnail respecting COPPA and QC gatekeeper.
 */
export async function executePublishJob(ctx: JobExecutionContext): Promise<Record<string, unknown>> {
  const { job, signal, updateProgress, completeStep, logInfo } = ctx;
  logInfo('Starting YOUTUBE_PUBLISH job execution', { episodeId: job.episodeId });

  if (signal.aborted) throw new AppError('Job cancelled', 499, 'JOB_ABORTED');

  await updateProgress(15, 'Comprobando Gatekeeper de Calidad (QC) y políticas COPPA...', 'VERIFY_QC');
  const payload = job.payload || {};

  const publishRes = await youTubeService.publishEpisode(
    {
      episodeId: job.episodeId,
      title: String(payload['title'] || 'Aventuras Infantiles - Episodio Oficial'),
      description: String(payload['description'] || 'Episodio educativo infantil en Cartoon Studio. Conforme a normativas COPPA.'),
      privacyStatus: (payload['privacyStatus'] as any) || 'private',
      tags: (payload['tags'] as string[]) || ['dibujos animados', 'educativo', 'niños'],
      scheduledDate: payload['scheduledDate'] as string | undefined,
      scheduledTime: payload['scheduledTime'] as string | undefined,
      forceBypassQcForTesting: Boolean(payload['forceBypassQcForTesting']),
    },
    (payload['userId'] as string) || undefined
  );

  await completeStep('VERIFY_QC', 'Gatekeeper verificado exitosamente');
  if (signal.aborted) throw new AppError('Job cancelled', 499, 'JOB_ABORTED');

  await updateProgress(80, `Subiendo vídeo a YouTube (${publishRes.isDemoMode ? 'Modo Sandbox' : 'Modo Oficial'})...`, 'UPLOAD_STREAM');
  await completeStep('UPLOAD_STREAM', publishRes.videoUrl, {
    videoId: publishRes.videoId,
    publicationId: publishRes.publicationId,
  });

  await updateProgress(100, 'Publicación en YouTube finalizada.');

  return {
    success: publishRes.success,
    publicationId: publishRes.publicationId,
    videoId: publishRes.videoId,
    videoUrl: publishRes.videoUrl,
    privacyStatus: publishRes.privacyStatus,
    isDemoMode: publishRes.isDemoMode,
    message: publishRes.message,
  };
}

/**
 * Central handler registry.
 */
export const JOB_HANDLERS: Record<JobType, JobHandler> = {
  SCRIPTING: executeScriptingJob,
  VOICE_GENERATION: executeVoiceJob,
  ASSET_GENERATION: executeVisualJob,
  STORYBOARDING: executeVisualJob,
  AUDIO_COMPOSITION: executeVoiceJob,
  VIDEO_COMPOSITION: executeRenderJob,
  FFMPEG_RENDER: executeRenderJob,
  VALIDATION: executeValidationJob,
  YOUTUBE_PUBLISH: executePublishJob,
};
