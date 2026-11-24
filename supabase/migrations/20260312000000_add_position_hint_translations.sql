-- Add position hint translation columns to fields table
ALTER TABLE fields ADD COLUMN IF NOT EXISTS position_hint_vi TEXT;
ALTER TABLE fields ADD COLUMN IF NOT EXISTS position_hint_es TEXT;
ALTER TABLE fields ADD COLUMN IF NOT EXISTS explanation_en TEXT;
