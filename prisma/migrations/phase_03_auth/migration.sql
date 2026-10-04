-- ==============================================================================
-- PHASE 03 MIGRATION — Auth columns and refresh token table
-- ==============================================================================

-- 1. Add password_hash column to users table
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "password_hash" VARCHAR(512);

-- 2. Create user_refresh_tokens table
CREATE TABLE IF NOT EXISTS "user_refresh_tokens" (
  "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    UUID         NOT NULL,
  "family_id"  UUID         NOT NULL,
  "token_hash" VARCHAR(64)  NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "expires_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW() + INTERVAL '30 days',

  CONSTRAINT "user_refresh_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_refresh_tokens_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "user_refresh_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

-- 3. Indexes for lookup performance
CREATE INDEX IF NOT EXISTS "idx_user_refresh_tokens_user_id"
  ON "user_refresh_tokens"("user_id");

CREATE INDEX IF NOT EXISTS "idx_user_refresh_tokens_family_id"
  ON "user_refresh_tokens"("family_id");
