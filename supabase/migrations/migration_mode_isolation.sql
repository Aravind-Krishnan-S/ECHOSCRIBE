-- 1. Sessions table — add mode column
ALTER TABLE sessions 
  ADD COLUMN IF NOT EXISTS session_mode TEXT NOT NULL DEFAULT 'Therapy'
  CHECK (session_mode IN ('Therapy', 'Mentoring', 'therapy', 'mentoring'));

-- 2. Patients table — conceptual rename via entity_type
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'Patient'
  CHECK (entity_type IN ('Patient', 'Mentee', 'patient', 'mentee'));

-- 3. Profiles table — add mode isolation (if table exists or needed in future)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  session_mode text
);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS session_mode TEXT NOT NULL DEFAULT 'Therapy'
  CHECK (session_mode IN ('Therapy', 'Mentoring', 'therapy', 'mentoring'));

-- 4. Indexes for filtered queries
CREATE INDEX IF NOT EXISTS idx_sessions_mode ON sessions(user_id, session_mode);
CREATE INDEX IF NOT EXISTS idx_patients_type ON patients(user_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_profiles_mode ON profiles(user_id, session_mode);
