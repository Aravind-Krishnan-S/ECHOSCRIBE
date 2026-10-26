-- EchoScribe: user profiles, synced provider keys, avatars
-- Run once in the Supabase SQL editor. Safe to re-run.

-- 1. User profiles (one row per auth user)
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name         text,
  avatar_url        text,
  title             text,
  organisation      text,
  license_id        text,
  specialisations   text[] NOT NULL DEFAULT '{}',
  phone             text,
  preferred_contact text CHECK (preferred_contact IN ('email', 'phone', 'either')),
  role              text NOT NULL DEFAULT 'therapist' CHECK (role IN ('therapist', 'mentor', 'both')),
  prefs             jsonb NOT NULL DEFAULT '{}'::jsonb,
  onboarding        jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own profile select" ON user_profiles;
DROP POLICY IF EXISTS "own profile insert" ON user_profiles;
DROP POLICY IF EXISTS "own profile update" ON user_profiles;
CREATE POLICY "own profile select" ON user_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own profile insert" ON user_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own profile update" ON user_profiles FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. Provider keys the user chose to sync (encrypted by the server with AES-256-GCM)
CREATE TABLE IF NOT EXISTS user_provider_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  family      text NOT NULL,
  label       text,
  ciphertext  text NOT NULL,
  iv          text NOT NULL,
  auth_tag    text NOT NULL,
  last4       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_provider_keys_user ON user_provider_keys(user_id);
ALTER TABLE user_provider_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own keys select" ON user_provider_keys;
DROP POLICY IF EXISTS "own keys insert" ON user_provider_keys;
DROP POLICY IF EXISTS "own keys delete" ON user_provider_keys;
CREATE POLICY "own keys select" ON user_provider_keys FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own keys insert" ON user_provider_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own keys delete" ON user_provider_keys FOR DELETE USING (auth.uid() = user_id);

-- 3. Avatars: public-read bucket, each user writes only inside a folder named after their id
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "avatar read" ON storage.objects;
DROP POLICY IF EXISTS "avatar write own" ON storage.objects;
DROP POLICY IF EXISTS "avatar update own" ON storage.objects;
DROP POLICY IF EXISTS "avatar delete own" ON storage.objects;
CREATE POLICY "avatar read" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY "avatar write own" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatar update own" ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatar delete own" ON storage.objects FOR DELETE
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 4. Sessions: allow the owner to update an edited note (used by PUT /api/session/:id)
DROP POLICY IF EXISTS "own sessions update" ON sessions;
CREATE POLICY "own sessions update" ON sessions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
