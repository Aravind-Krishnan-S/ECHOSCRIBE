ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_mode text DEFAULT 'Therapy' CHECK (session_mode IN ('Therapy', 'Mentoring'));
ALTER TABLE patients ADD COLUMN IF NOT EXISTS entity_type text DEFAULT 'Patient' CHECK (entity_type IN ('Patient', 'Mentee'));
