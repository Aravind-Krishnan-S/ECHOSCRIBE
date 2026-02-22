-- Run this in your Supabase SQL Editor to add email and phone columns to the patients table
ALTER TABLE patients 
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;
