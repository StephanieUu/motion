ALTER TABLE user_profile ADD COLUMN activity_level TEXT
  CHECK (activity_level IS NULL OR activity_level IN ('INACTIVE','LOW_ACTIVE','ACTIVE','VERY_ACTIVE'));

CREATE TABLE app_preferences (
  preference_key TEXT PRIMARY KEY NOT NULL CHECK (length(trim(preference_key)) > 0),
  preference_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE body_measurements (
  id TEXT PRIMARY KEY NOT NULL,
  measured_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('MANUAL','HEALTH_CONNECT','SCREENSHOT_OCR','BOOHEE','OTHER')),
  weight_kg REAL NOT NULL CHECK (weight_kg > 0),
  user_verified INTEGER NOT NULL CHECK (user_verified IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_body_measurements_date ON body_measurements(local_date DESC, measured_at DESC);

CREATE TABLE meals (
  id TEXT PRIMARY KEY NOT NULL,
  local_date TEXT NOT NULL,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('BREAKFAST','LUNCH','DINNER','SNACK','OTHER')),
  logged_at TEXT NOT NULL,
  note TEXT
);
CREATE INDEX idx_meals_date ON meals(local_date, logged_at);

CREATE TABLE food_entries (
  id TEXT PRIMARY KEY NOT NULL,
  meal_id TEXT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  quantity REAL CHECK (quantity IS NULL OR quantity >= 0),
  unit TEXT,
  calories_kcal REAL CHECK (calories_kcal IS NULL OR calories_kcal >= 0),
  protein_g REAL CHECK (protein_g IS NULL OR protein_g >= 0),
  carbs_g REAL CHECK (carbs_g IS NULL OR carbs_g >= 0),
  fat_g REAL CHECK (fat_g IS NULL OR fat_g >= 0),
  estimation_method TEXT NOT NULL CHECK (estimation_method IN
    ('EXACT_WEIGHT','PACKAGE_LABEL','FOOD_DATABASE','TEXT_AI','PHOTO_AI','ROUGH_CALORIE','MANUAL')),
  confidence_level TEXT NOT NULL CHECK (confidence_level IN ('HIGH','MEDIUM','LOW','ROUGH')),
  raw_input TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_food_entries_meal ON food_entries(meal_id);

CREATE TABLE meal_templates (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  template_data_json TEXT NOT NULL CHECK (json_valid(template_data_json)),
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE daily_nutrition_targets (
  id TEXT PRIMARY KEY NOT NULL,
  local_date TEXT NOT NULL UNIQUE,
  calories_min REAL NOT NULL CHECK (calories_min >= 0),
  calories_max REAL NOT NULL CHECK (calories_max >= calories_min),
  protein_min_g REAL NOT NULL CHECK (protein_min_g >= 0),
  protein_max_g REAL NOT NULL CHECK (protein_max_g >= protein_min_g),
  carbs_target_g REAL CHECK (carbs_target_g IS NULL OR carbs_target_g >= 0),
  fat_target_g REAL CHECK (fat_target_g IS NULL OR fat_target_g >= 0),
  day_type TEXT NOT NULL CHECK (day_type = 'NORMAL'),
  calculation_version TEXT NOT NULL,
  rationale_json TEXT NOT NULL CHECK (json_valid(rationale_json)),
  created_at TEXT NOT NULL
);
