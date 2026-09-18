ALTER TABLE body_measurements RENAME TO body_measurements_m8;

CREATE TABLE body_measurements (
  id TEXT PRIMARY KEY NOT NULL,
  measured_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('BOOHEE','HEALTH_CONNECT','SCREENSHOT_OCR','MANUAL','OTHER')),
  weight_kg REAL CHECK (weight_kg IS NULL OR weight_kg > 0),
  body_fat_percent REAL CHECK (body_fat_percent IS NULL OR (body_fat_percent >= 0 AND body_fat_percent <= 100)),
  bmi REAL CHECK (bmi IS NULL OR bmi > 0),
  fat_mass_kg REAL CHECK (fat_mass_kg IS NULL OR fat_mass_kg >= 0),
  muscle_mass_kg REAL CHECK (muscle_mass_kg IS NULL OR muscle_mass_kg >= 0),
  skeletal_muscle REAL CHECK (skeletal_muscle IS NULL OR (skeletal_muscle >= 0 AND skeletal_muscle <= 100)),
  body_water_percent REAL CHECK (body_water_percent IS NULL OR (body_water_percent >= 0 AND body_water_percent <= 100)),
  visceral_fat_level REAL CHECK (visceral_fat_level IS NULL OR visceral_fat_level >= 0),
  bone_mass_kg REAL CHECK (bone_mass_kg IS NULL OR bone_mass_kg >= 0),
  bmr_kcal REAL CHECK (bmr_kcal IS NULL OR bmr_kcal > 0),
  body_age REAL CHECK (body_age IS NULL OR body_age > 0),
  raw_data_json TEXT CHECK (raw_data_json IS NULL OR json_valid(raw_data_json)),
  confidence_level TEXT CHECK (confidence_level IS NULL OR confidence_level IN ('HIGH','MEDIUM','LOW','ROUGH')),
  user_verified INTEGER NOT NULL CHECK (user_verified IN (0,1)),
  external_record_id TEXT,
  source_app TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (weight_kg IS NOT NULL OR body_fat_percent IS NOT NULL OR bmi IS NOT NULL OR fat_mass_kg IS NOT NULL OR
    muscle_mass_kg IS NOT NULL OR skeletal_muscle IS NOT NULL OR body_water_percent IS NOT NULL OR
    visceral_fat_level IS NOT NULL OR bone_mass_kg IS NOT NULL OR bmr_kcal IS NOT NULL OR body_age IS NOT NULL)
);

INSERT INTO body_measurements (id,measured_at,local_date,source_type,weight_kg,user_verified,created_at,updated_at)
SELECT id,measured_at,local_date,source_type,weight_kg,user_verified,created_at,created_at FROM body_measurements_m8;
DROP TABLE body_measurements_m8;
CREATE INDEX idx_body_measurements_date ON body_measurements(local_date DESC, measured_at DESC);
CREATE UNIQUE INDEX idx_body_measurements_health_connect_external ON body_measurements(external_record_id)
  WHERE source_type='HEALTH_CONNECT' AND external_record_id IS NOT NULL;

CREATE TABLE measurement_imports (
  id TEXT PRIMARY KEY NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type='SCREENSHOT_OCR'),
  raw_ocr_text TEXT,
  parsed_data_json TEXT CHECK (parsed_data_json IS NULL OR json_valid(parsed_data_json)),
  status TEXT NOT NULL CHECK (status IN ('RECEIVED','PARSED','CONFIRMED','REJECTED','FAILED')),
  resulting_measurement_id TEXT REFERENCES body_measurements(id) ON DELETE SET NULL,
  imported_at TEXT NOT NULL,
  confirmed_at TEXT,
  error_message TEXT
);

CREATE TABLE health_daily_summaries (
  local_date TEXT PRIMARY KEY NOT NULL,
  steps INTEGER CHECK (steps IS NULL OR steps >= 0),
  active_calories_kcal REAL CHECK (active_calories_kcal IS NULL OR active_calories_kcal >= 0),
  exercise_minutes INTEGER CHECK (exercise_minutes IS NULL OR exercise_minutes >= 0),
  sleep_minutes INTEGER CHECK (sleep_minutes IS NULL OR sleep_minutes >= 0),
  resting_heart_rate REAL CHECK (resting_heart_rate IS NULL OR resting_heart_rate >= 0),
  average_heart_rate REAL CHECK (average_heart_rate IS NULL OR average_heart_rate >= 0),
  source_summary_json TEXT CHECK (source_summary_json IS NULL OR json_valid(source_summary_json)),
  last_synced_at TEXT NOT NULL
);

CREATE TABLE health_sync_state (
  provider TEXT NOT NULL CHECK (provider='HEALTH_CONNECT'),
  record_type TEXT NOT NULL,
  last_sync_at TEXT,
  changes_token TEXT,
  status TEXT NOT NULL CHECK (status IN ('NEVER_SYNCED','SYNCED','PERMISSION_MISSING','UNAVAILABLE','ERROR')),
  last_error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider,record_type)
);
