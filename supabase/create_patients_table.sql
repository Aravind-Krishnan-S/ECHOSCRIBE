-- ============================================
-- EchoScribe: Create patients table + RLS
-- Run this in the Supabase SQL Editor
-- ============================================

-- 1. Create the patients table
CREATE TABLE IF NOT EXISTS patients (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    age INTEGER,
    gender TEXT,
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Add patient_id column to sessions (if it doesn't exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sessions' AND column_name = 'patient_id'
    ) THEN
        ALTER TABLE sessions ADD COLUMN patient_id UUID REFERENCES patients(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 3. Enable RLS
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies — users can only access their own patients (safe to re-run)
DROP POLICY IF EXISTS "Users can view their own patients" ON patients;
CREATE POLICY "Users can view their own patients"
    ON patients FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own patients" ON patients;
CREATE POLICY "Users can insert their own patients"
    ON patients FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own patients" ON patients;
CREATE POLICY "Users can update their own patients"
    ON patients FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own patients" ON patients;
CREATE POLICY "Users can delete their own patients"
    ON patients FOR DELETE
    USING (auth.uid() = user_id);

-- 5. Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_patients_user_id ON patients(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_patient_id ON sessions(patient_id);
