CREATE TABLE nutrition_plan_runs (
  id TEXT PRIMARY KEY NOT NULL,
  base_strategy TEXT NOT NULL CHECK (base_strategy IN ('STABLE_FAT_LOSS','FOCUSED_FAT_LOSS','MAINTENANCE')),
  status TEXT NOT NULL CHECK (status IN ('SCHEDULED','ACTIVE','ENDED')),
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  high_protein INTEGER NOT NULL CHECK (high_protein IN (0,1)),
  tre_enabled INTEGER NOT NULL CHECK (tre_enabled IN (0,1)),
  tre_start_local_time TEXT,
  tre_window_minutes INTEGER,
  flexible_weekday INTEGER,
  config_version INTEGER NOT NULL CHECK (config_version > 0),
  ended_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((tre_enabled=0 AND tre_start_local_time IS NULL AND tre_window_minutes IS NULL) OR
    (tre_enabled=1 AND tre_start_local_time GLOB '[0-2][0-9]:[0-5][0-9]' AND
      CAST(substr(tre_start_local_time,1,2) AS INTEGER) BETWEEN 0 AND 23 AND
      tre_window_minutes BETWEEN 480 AND 720 AND tre_window_minutes % 60 = 0)),
  CHECK (flexible_weekday IS NULL OR flexible_weekday BETWEEN 0 AND 6),
  CHECK (base_strategy <> 'MAINTENANCE' OR flexible_weekday IS NULL),
  CHECK ((status='ENDED' AND ends_on IS NOT NULL) OR (status<>'ENDED' AND ends_on IS NULL)),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE UNIQUE INDEX idx_nutrition_plan_runs_one_active
  ON nutrition_plan_runs(status) WHERE status='ACTIVE';
CREATE UNIQUE INDEX idx_nutrition_plan_runs_one_scheduled
  ON nutrition_plan_runs(status) WHERE status='SCHEDULED';
CREATE INDEX idx_nutrition_plan_runs_dates ON nutrition_plan_runs(starts_on,ends_on);

ALTER TABLE daily_nutrition_targets RENAME TO daily_nutrition_targets_m7;

CREATE TABLE daily_nutrition_targets (
  id TEXT PRIMARY KEY NOT NULL,
  local_date TEXT NOT NULL UNIQUE,
  calories_min REAL NOT NULL CHECK (calories_min >= 0),
  calories_max REAL NOT NULL CHECK (calories_max >= calories_min),
  protein_min_g REAL NOT NULL CHECK (protein_min_g >= 0),
  protein_max_g REAL NOT NULL CHECK (protein_max_g >= protein_min_g),
  carbs_target_g REAL CHECK (carbs_target_g IS NULL OR carbs_target_g >= 0),
  fat_target_g REAL CHECK (fat_target_g IS NULL OR fat_target_g >= 0),
  nutrition_plan_run_id TEXT REFERENCES nutrition_plan_runs(id) ON DELETE RESTRICT,
  day_type TEXT NOT NULL CHECK (day_type IN ('NORMAL','TRAINING','REST','FLEXIBLE','MAINTENANCE','LOW_INTAKE')),
  calculation_version TEXT NOT NULL,
  rationale_json TEXT NOT NULL CHECK (json_valid(rationale_json)),
  created_at TEXT NOT NULL
);

INSERT INTO daily_nutrition_targets
  (id,local_date,calories_min,calories_max,protein_min_g,protein_max_g,carbs_target_g,fat_target_g,
    nutrition_plan_run_id,day_type,calculation_version,rationale_json,created_at)
SELECT id,local_date,calories_min,calories_max,protein_min_g,protein_max_g,carbs_target_g,fat_target_g,
  NULL,day_type,calculation_version,rationale_json,created_at
FROM daily_nutrition_targets_m7;

DROP TABLE daily_nutrition_targets_m7;
CREATE INDEX idx_daily_nutrition_targets_plan_run ON daily_nutrition_targets(nutrition_plan_run_id,local_date);
