-- CreateEnum
CREATE TYPE "EpisodeStatus" AS ENUM ('DRAFT', 'READY_FOR_PRODUCTION', 'IN_PRODUCTION', 'READY_FOR_REVIEW', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('SCRIPTING', 'STORYBOARDING', 'VOICE_GENERATION', 'ASSET_GENERATION', 'AUDIO_COMPOSITION', 'VIDEO_COMPOSITION', 'FFMPEG_RENDER', 'VALIDATION');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'SKIPPED_REUSED', 'FAILED');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('IMAGE_SCENE', 'IMAGE_CHARACTER', 'AUDIO_VOICE', 'AUDIO_MUSIC', 'AUDIO_SFX', 'VIDEO_RENDER', 'SUBTITLE_SRT', 'SUBTITLE_VTT', 'THUMBNAIL');

-- CreateEnum
CREATE TYPE "StorageDriver" AS ENUM ('LOCAL', 'S3');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('GEMINI', 'IMAGEN', 'GOOGLE_TTS', 'ELEVENLABS', 'YOUTUBE_DATA_API');

-- CreateEnum
CREATE TYPE "QCCategory" AS ENUM ('SAFETY_COMPLIANCE', 'CONTENT', 'CONTINUITY', 'AUDIO', 'VISUAL', 'TECHNICAL');

-- CreateEnum
CREATE TYPE "QCSeverity" AS ENUM ('CRITICAL', 'WARNING');

-- CreateEnum
CREATE TYPE "QCCheckStatus" AS ENUM ('PASS', 'WARNING', 'FAIL');

-- CreateEnum
CREATE TYPE "EditorialStatus" AS ENUM ('DRAFT_SCHEDULE', 'CONFIRMED', 'RESCHEDULED', 'BROADCASTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChannelConnectionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'INSUFFICIENT_SCOPES');

-- CreateEnum
CREATE TYPE "PrivacyStatus" AS ENUM ('PRIVATE', 'UNLISTED', 'PUBLIC', 'SCHEDULED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "main_character_name" VARCHAR(100) NOT NULL,
    "visual_style" VARCHAR(255) NOT NULL,
    "target_age" VARCHAR(50) NOT NULL,
    "language" VARCHAR(50) NOT NULL DEFAULT 'Spanish',
    "episode_length_default" VARCHAR(50),
    "narrative_rules" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_definitions" (
    "id" UUID NOT NULL,
    "series_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "species" VARCHAR(100) NOT NULL,
    "personality" TEXT,
    "age" VARCHAR(50),
    "color_palette" JSONB NOT NULL DEFAULT '[]',
    "clothing" TEXT,
    "visual_features" TEXT,
    "visual_consistency_prompt" TEXT NOT NULL,
    "master_prompt" TEXT NOT NULL,
    "tagline" VARCHAR(255),
    "turnaround_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "character_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_voice_profiles" (
    "id" UUID NOT NULL,
    "character_definition_id" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'google-cloud-tts',
    "voice_id" VARCHAR(100) NOT NULL,
    "pitch" DECIMAL(4,2) NOT NULL DEFAULT 1.00,
    "speed" DECIMAL(4,2) NOT NULL DEFAULT 1.00,
    "timbre" VARCHAR(100),
    "language" VARCHAR(50) NOT NULL DEFAULT 'es-ES',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "character_voice_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episodes" (
    "id" UUID NOT NULL,
    "series_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "idea" TEXT NOT NULL,
    "target_age" VARCHAR(50) NOT NULL,
    "language" VARCHAR(50) NOT NULL DEFAULT 'Spanish',
    "duration_category" VARCHAR(50),
    "educational_objective" TEXT,
    "tone" VARCHAR(100),
    "status" "EpisodeStatus" NOT NULL DEFAULT 'DRAFT',
    "logline" TEXT,
    "moral" TEXT,
    "ending" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_characters" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "character_definition_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "role_description" TEXT,
    "clothing_override" TEXT,
    "emotional_state" VARCHAR(100),
    "voice_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "episode_characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenes" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "scene_index" INTEGER NOT NULL,
    "scene_code" VARCHAR(50) NOT NULL,
    "location" VARCHAR(255) NOT NULL,
    "time_of_day" VARCHAR(50) NOT NULL,
    "action_description" TEXT NOT NULL,
    "camera_direction" TEXT,
    "dialogue_text" TEXT,
    "narration_text" TEXT,
    "sound_effects" TEXT,
    "music_cue" TEXT,
    "duration_seconds" INTEGER NOT NULL DEFAULT 15,
    "visual_prompt" TEXT NOT NULL,
    "motion_type" VARCHAR(50) NOT NULL DEFAULT 'pan-left',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "type" "AssetType" NOT NULL,
    "slot_name" VARCHAR(100) NOT NULL,
    "current_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_versions" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "storage_driver" "StorageDriver" NOT NULL DEFAULT 'LOCAL',
    "storage_key" VARCHAR(1024) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" VARCHAR(64) NOT NULL,
    "generation_parameters" JSONB,
    "created_by_job_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_versions" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "snapshot_data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episode_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_jobs" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "episode_version_id" UUID,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "step_description" TEXT,
    "error_message" TEXT,
    "error_details" JSONB,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "production_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_steps" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "step_index" INTEGER NOT NULL,
    "step_key" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "input_hash" VARCHAR(64) NOT NULL,
    "output_reference" VARCHAR(1024),
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "duration_ms" INTEGER,
    "error_message" TEXT,
    "error_stack" TEXT,
    "output_payload" JSONB,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_executions" (
    "id" UUID NOT NULL,
    "job_id" UUID,
    "episode_id" UUID NOT NULL,
    "provider" "ProviderType" NOT NULL,
    "model_or_service" VARCHAR(100) NOT NULL,
    "operation" VARCHAR(100) NOT NULL,
    "request_hash" VARCHAR(64),
    "latency_ms" INTEGER,
    "http_status" INTEGER,
    "error_code" VARCHAR(100),
    "input_units" INTEGER NOT NULL DEFAULT 0,
    "output_units" INTEGER NOT NULL DEFAULT 0,
    "cost_eur" DECIMAL(10,6),
    "raw_usage_metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_reports" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "episode_version_id" UUID NOT NULL,
    "overall_score" INTEGER NOT NULL,
    "approved_for_production" BOOLEAN NOT NULL DEFAULT false,
    "auditor_type" VARCHAR(50) NOT NULL DEFAULT 'AI_ENGINE',
    "auditor_model" VARCHAR(100) NOT NULL DEFAULT 'gemini-3.8-flash',
    "audited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "qc_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_checks" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "category" "QCCategory" NOT NULL,
    "rule_code" VARCHAR(100) NOT NULL,
    "severity" "QCSeverity" NOT NULL DEFAULT 'CRITICAL',
    "status" "QCCheckStatus" NOT NULL DEFAULT 'PASS',
    "score" INTEGER NOT NULL DEFAULT 100,
    "notes" TEXT,
    "remediation" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editorial_calendar_items" (
    "id" UUID NOT NULL,
    "series_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "episode_id" UUID,
    "planned_at" TIMESTAMPTZ(6) NOT NULL,
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'UTC',
    "editorial_status" "EditorialStatus" NOT NULL DEFAULT 'DRAFT_SCHEDULE',
    "notes" TEXT,
    "youtube_publication_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "editorial_calendar_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_oauth_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "google_user_id" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "encrypted_access_token" TEXT NOT NULL,
    "encrypted_refresh_token" TEXT NOT NULL,
    "iv" VARCHAR(64) NOT NULL,
    "auth_tag" VARCHAR(64) NOT NULL,
    "token_expiry" TIMESTAMPTZ(6) NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "google_oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "youtube_channels" (
    "id" UUID NOT NULL,
    "channel_id" VARCHAR(100) NOT NULL,
    "channel_title" VARCHAR(255) NOT NULL,
    "channel_custom_url" VARCHAR(100),
    "subscriber_count" VARCHAR(50),
    "video_count" INTEGER NOT NULL DEFAULT 0,
    "view_count" VARCHAR(50),
    "avatar_url" TEXT,
    "is_demo_mode" BOOLEAN NOT NULL DEFAULT false,
    "status_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "youtube_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "youtube_channel_connections" (
    "id" UUID NOT NULL,
    "google_oauth_account_id" UUID NOT NULL,
    "youtube_channel_id" UUID NOT NULL,
    "status" "ChannelConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "is_primary_uploader" BOOLEAN NOT NULL DEFAULT true,
    "last_verified_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "youtube_channel_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "youtube_publications" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "episode_version_id" UUID,
    "youtube_channel_id" UUID NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "hashtags" JSONB NOT NULL DEFAULT '[]',
    "made_for_kids" BOOLEAN NOT NULL DEFAULT true,
    "privacy_status" "PrivacyStatus" NOT NULL DEFAULT 'PRIVATE',
    "category_id" VARCHAR(20) NOT NULL DEFAULT '1',
    "thumbnail_overlay_text" VARCHAR(100),
    "recommended_playlist" VARCHAR(255),
    "coppa_compliance_confirmed" BOOLEAN NOT NULL DEFAULT true,
    "scheduled_at" TIMESTAMPTZ(6),
    "published_video_id" VARCHAR(100),
    "published_video_url" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "youtube_publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_series_user_id" ON "series"("user_id");

-- CreateIndex
CREATE INDEX "idx_character_definitions_series_id" ON "character_definitions"("series_id");

-- CreateIndex
CREATE INDEX "idx_character_voice_profiles_char_id" ON "character_voice_profiles"("character_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "character_voice_profiles_character_definition_id_language_p_key" ON "character_voice_profiles"("character_definition_id", "language", "provider", "voice_id");

-- CreateIndex
CREATE INDEX "idx_episodes_series_status" ON "episodes"("series_id", "status");

-- CreateIndex
CREATE INDEX "idx_episode_characters_episode_id" ON "episode_characters"("episode_id");

-- CreateIndex
CREATE INDEX "idx_scenes_episode_id" ON "scenes"("episode_id");

-- CreateIndex
CREATE UNIQUE INDEX "scenes_episode_id_scene_index_key" ON "scenes"("episode_id", "scene_index");

-- CreateIndex
CREATE INDEX "idx_assets_episode_type" ON "assets"("episode_id", "type");

-- CreateIndex
CREATE INDEX "idx_asset_versions_sha256" ON "asset_versions"("checksum_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "asset_versions_asset_id_version_number_key" ON "asset_versions"("asset_id", "version_number");

-- CreateIndex
CREATE INDEX "idx_episode_versions_episode_id" ON "episode_versions"("episode_id");

-- CreateIndex
CREATE UNIQUE INDEX "episode_versions_episode_id_version_number_key" ON "episode_versions"("episode_id", "version_number");

-- CreateIndex
CREATE INDEX "idx_production_jobs_status_created" ON "production_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "idx_production_jobs_episode_id" ON "production_jobs"("episode_id");

-- CreateIndex
CREATE INDEX "idx_job_steps_job_status" ON "job_steps"("job_id", "status");

-- CreateIndex
CREATE INDEX "idx_job_steps_input_hash" ON "job_steps"("input_hash");

-- CreateIndex
CREATE UNIQUE INDEX "job_steps_job_id_step_index_key" ON "job_steps"("job_id", "step_index");

-- CreateIndex
CREATE INDEX "idx_provider_executions_episode" ON "provider_executions"("episode_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_provider_executions_provider" ON "provider_executions"("provider", "created_at");

-- CreateIndex
CREATE INDEX "idx_qc_reports_version_id" ON "qc_reports"("episode_version_id");

-- CreateIndex
CREATE INDEX "idx_qc_reports_episode_id" ON "qc_reports"("episode_id");

-- CreateIndex
CREATE INDEX "idx_qc_checks_status" ON "qc_checks"("report_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "qc_checks_report_id_rule_code_key" ON "qc_checks"("report_id", "rule_code");

-- CreateIndex
CREATE INDEX "idx_calendar_series_planned" ON "editorial_calendar_items"("series_id", "planned_at");

-- CreateIndex
CREATE INDEX "idx_calendar_planned_status" ON "editorial_calendar_items"("planned_at", "editorial_status");

-- CreateIndex
CREATE INDEX "idx_calendar_episode_id" ON "editorial_calendar_items"("episode_id");

-- CreateIndex
CREATE UNIQUE INDEX "google_oauth_accounts_user_id_google_user_id_key" ON "google_oauth_accounts"("user_id", "google_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "youtube_channels_channel_id_key" ON "youtube_channels"("channel_id");

-- CreateIndex
CREATE INDEX "idx_channel_connections_status" ON "youtube_channel_connections"("youtube_channel_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "youtube_channel_connections_google_oauth_account_id_youtube_key" ON "youtube_channel_connections"("google_oauth_account_id", "youtube_channel_id");

-- CreateIndex
CREATE INDEX "idx_youtube_publications_episode_id" ON "youtube_publications"("episode_id");

-- CreateIndex
CREATE INDEX "idx_youtube_publications_channel_status" ON "youtube_publications"("youtube_channel_id", "privacy_status");

-- AddForeignKey
ALTER TABLE "series" ADD CONSTRAINT "series_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_definitions" ADD CONSTRAINT "character_definitions_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_voice_profiles" ADD CONSTRAINT "character_voice_profiles_character_definition_id_fkey" FOREIGN KEY ("character_definition_id") REFERENCES "character_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_characters" ADD CONSTRAINT "episode_characters_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_characters" ADD CONSTRAINT "episode_characters_character_definition_id_fkey" FOREIGN KEY ("character_definition_id") REFERENCES "character_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_created_by_job_id_fkey" FOREIGN KEY ("created_by_job_id") REFERENCES "production_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_versions" ADD CONSTRAINT "episode_versions_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_episode_version_id_fkey" FOREIGN KEY ("episode_version_id") REFERENCES "episode_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "production_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_executions" ADD CONSTRAINT "provider_executions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "production_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_executions" ADD CONSTRAINT "provider_executions_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reports" ADD CONSTRAINT "qc_reports_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reports" ADD CONSTRAINT "qc_reports_episode_version_id_fkey" FOREIGN KEY ("episode_version_id") REFERENCES "episode_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_checks" ADD CONSTRAINT "qc_checks_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "qc_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_calendar_items" ADD CONSTRAINT "editorial_calendar_items_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_calendar_items" ADD CONSTRAINT "editorial_calendar_items_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_calendar_items" ADD CONSTRAINT "editorial_calendar_items_youtube_publication_id_fkey" FOREIGN KEY ("youtube_publication_id") REFERENCES "youtube_publications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_oauth_accounts" ADD CONSTRAINT "google_oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "youtube_channel_connections" ADD CONSTRAINT "youtube_channel_connections_google_oauth_account_id_fkey" FOREIGN KEY ("google_oauth_account_id") REFERENCES "google_oauth_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "youtube_channel_connections" ADD CONSTRAINT "youtube_channel_connections_youtube_channel_id_fkey" FOREIGN KEY ("youtube_channel_id") REFERENCES "youtube_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "youtube_publications" ADD CONSTRAINT "youtube_publications_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "youtube_publications" ADD CONSTRAINT "youtube_publications_episode_version_id_fkey" FOREIGN KEY ("episode_version_id") REFERENCES "episode_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "youtube_publications" ADD CONSTRAINT "youtube_publications_youtube_channel_id_fkey" FOREIGN KEY ("youtube_channel_id") REFERENCES "youtube_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

