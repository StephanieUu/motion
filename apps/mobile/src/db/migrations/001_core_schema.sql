CREATE TABLE activity_types (
  id TEXT PRIMARY KEY NOT NULL,
  system_key TEXT UNIQUE,
  name TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);
CREATE TRIGGER protect_other_delete BEFORE DELETE ON activity_types
WHEN OLD.system_key = 'OTHER' BEGIN SELECT RAISE(ABORT, 'OTHER activity type cannot be deleted'); END;
CREATE TRIGGER protect_other_update BEFORE UPDATE ON activity_types
WHEN OLD.system_key = 'OTHER' AND (NEW.system_key IS NOT 'OTHER' OR NEW.is_active != 1 OR NEW.is_system != 1)
BEGIN SELECT RAISE(ABORT, 'OTHER activity type cannot be changed'); END;

CREATE TABLE activity_preferences (
  id TEXT PRIMARY KEY NOT NULL,
  activity_type_id TEXT NOT NULL UNIQUE REFERENCES activity_types(id) ON DELETE RESTRICT,
  explicit_preference TEXT NOT NULL DEFAULT 'NEUTRAL' CHECK (explicit_preference IN ('LOVE','LIKE','NEUTRAL','DISLIKE','AVOID')),
  inferred_score REAL NOT NULL DEFAULT 0,
  times_recommended INTEGER NOT NULL DEFAULT 0 CHECK (times_recommended >= 0),
  times_accepted INTEGER NOT NULL DEFAULT 0 CHECK (times_accepted >= 0),
  times_completed INTEGER NOT NULL DEFAULT 0 CHECK (times_completed >= 0),
  times_rejected INTEGER NOT NULL DEFAULT 0 CHECK (times_rejected >= 0),
  last_completed_at TEXT,
  temporarily_suppressed_until TEXT
);

CREATE TABLE workout_contents (
  id TEXT PRIMARY KEY NOT NULL,
  content_kind TEXT NOT NULL CHECK (content_kind IN ('FOLLOW_ALONG','FREE_ACTIVITY','MINI_ROUTINE')),
  title TEXT,
  description TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('BILIBILI','XIAOHONGSHU','QUARK','YOUTUBE','LOCAL','WEB','APP_BUILTIN','MANUAL')),
  source_url TEXT,
  external_id TEXT,
  thumbnail_uri TEXT,
  duration_minutes REAL CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  primary_activity_type_id TEXT REFERENCES activity_types(id) ON DELETE RESTRICT,
  estimated_intensity TEXT,
  impact_level TEXT,
  requires_equipment INTEGER CHECK (requires_equipment IN (0,1)),
  has_jumping INTEGER CHECK (has_jumping IN (0,1)),
  body_areas_json TEXT,
  psychological_barrier TEXT,
  user_visibility TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (user_visibility IN ('ACTIVE','TEMPORARILY_HIDDEN','ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_workout_contents_visibility ON workout_contents(user_visibility);

CREATE TABLE workout_imports (
  id TEXT PRIMARY KEY NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('BILIBILI','XIAOHONGSHU','QUARK','YOUTUBE','LOCAL','WEB','APP_BUILTIN','MANUAL')),
  raw_url TEXT,
  raw_shared_text TEXT,
  raw_file_path TEXT,
  raw_metadata_json TEXT,
  fingerprint TEXT,
  import_status TEXT NOT NULL CHECK (import_status IN ('RECEIVED','PARSING','READY','NEEDS_MORE_INFO','FAILED','IGNORED')),
  workout_content_id TEXT REFERENCES workout_contents(id) ON DELETE RESTRICT,
  imported_at TEXT NOT NULL,
  last_checked_at TEXT
);
CREATE INDEX idx_workout_imports_content ON workout_imports(workout_content_id);

CREATE TABLE content_analyses (
  id TEXT PRIMARY KEY NOT NULL,
  workout_content_id TEXT NOT NULL REFERENCES workout_contents(id) ON DELETE RESTRICT,
  fingerprint TEXT NOT NULL,
  analysis_version INTEGER NOT NULL CHECK (analysis_version > 0),
  method TEXT NOT NULL CHECK (method IN ('METADATA','RULES','OCR','LOCAL_ML','GEMINI','DEEPSEEK','MANUAL')),
  provider TEXT,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  extracted_data_json TEXT NOT NULL,
  analyzed_at TEXT NOT NULL
);

CREATE TABLE training_plans (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('BILIBILI','XIAOHONGSHU','QUARK','YOUTUBE','LOCAL','WEB','APP_BUILTIN','MANUAL')),
  source_reference TEXT,
  planned_days INTEGER CHECK (planned_days IS NULL OR planned_days > 0),
  cover_uri TEXT,
  original_metadata_json TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE TABLE training_plan_days (
  id TEXT PRIMARY KEY NOT NULL,
  training_plan_id TEXT NOT NULL REFERENCES training_plans(id) ON DELETE RESTRICT,
  day_index INTEGER NOT NULL CHECK (day_index > 0),
  original_label TEXT,
  title TEXT,
  is_rest_day INTEGER NOT NULL DEFAULT 0 CHECK (is_rest_day IN (0,1)),
  expected_duration_minutes REAL CHECK (expected_duration_minutes IS NULL OR expected_duration_minutes >= 0),
  expected_intensity TEXT,
  notes TEXT,
  UNIQUE(training_plan_id, day_index)
);
CREATE TABLE training_plan_day_items (
  id TEXT PRIMARY KEY NOT NULL,
  training_plan_day_id TEXT NOT NULL REFERENCES training_plan_days(id) ON DELETE RESTRICT,
  workout_content_id TEXT NOT NULL REFERENCES workout_contents(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  role TEXT NOT NULL CHECK (role IN ('PRIMARY','SUPPLEMENTAL')),
  UNIQUE(training_plan_day_id, sort_order)
);
CREATE UNIQUE INDEX one_primary_per_plan_day ON training_plan_day_items(training_plan_day_id) WHERE role = 'PRIMARY';
CREATE TRIGGER no_rest_day_items_insert BEFORE INSERT ON training_plan_day_items
WHEN (SELECT is_rest_day FROM training_plan_days WHERE id = NEW.training_plan_day_id) = 1
BEGIN SELECT RAISE(ABORT, 'rest day cannot contain items'); END;
CREATE TRIGGER no_rest_day_items_update BEFORE UPDATE ON training_plan_day_items
WHEN (SELECT is_rest_day FROM training_plan_days WHERE id = NEW.training_plan_day_id) = 1
BEGIN SELECT RAISE(ABORT, 'rest day cannot contain items'); END;
CREATE TRIGGER no_rest_day_with_items BEFORE UPDATE OF is_rest_day ON training_plan_days
WHEN NEW.is_rest_day = 1 AND EXISTS (SELECT 1 FROM training_plan_day_items WHERE training_plan_day_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'rest day cannot contain items'); END;
CREATE TRIGGER immutable_referenced_plan_day_update BEFORE UPDATE ON training_plan_days
WHEN EXISTS (SELECT 1 FROM training_plan_runs WHERE training_plan_id=OLD.training_plan_id)
BEGIN SELECT RAISE(ABORT, 'referenced plan days are immutable'); END;
CREATE TRIGGER immutable_referenced_plan_day_insert BEFORE INSERT ON training_plan_days
WHEN EXISTS (SELECT 1 FROM training_plan_runs WHERE training_plan_id=NEW.training_plan_id)
BEGIN SELECT RAISE(ABORT, 'referenced plan days are immutable'); END;
CREATE TRIGGER immutable_referenced_plan_day_delete BEFORE DELETE ON training_plan_days
WHEN EXISTS (SELECT 1 FROM training_plan_runs WHERE training_plan_id=OLD.training_plan_id)
BEGIN SELECT RAISE(ABORT, 'referenced plan days are immutable'); END;
CREATE TRIGGER immutable_referenced_plan_item_update BEFORE UPDATE ON training_plan_day_items
WHEN EXISTS (SELECT 1 FROM training_plan_runs r JOIN training_plan_days d ON d.training_plan_id=r.training_plan_id WHERE d.id=OLD.training_plan_day_id)
BEGIN SELECT RAISE(ABORT, 'referenced plan items are immutable'); END;
CREATE TRIGGER immutable_referenced_plan_item_delete BEFORE DELETE ON training_plan_day_items
WHEN EXISTS (SELECT 1 FROM training_plan_runs r JOIN training_plan_days d ON d.training_plan_id=r.training_plan_id WHERE d.id=OLD.training_plan_day_id)
BEGIN SELECT RAISE(ABORT, 'referenced plan items are immutable'); END;
CREATE TRIGGER immutable_referenced_plan_item_insert BEFORE INSERT ON training_plan_day_items
WHEN EXISTS (SELECT 1 FROM training_plan_runs r JOIN training_plan_days d ON d.training_plan_id=r.training_plan_id WHERE d.id=NEW.training_plan_day_id)
BEGIN SELECT RAISE(ABORT, 'referenced plan items are immutable'); END;

CREATE TABLE training_plan_runs (
  id TEXT PRIMARY KEY NOT NULL,
  training_plan_id TEXT NOT NULL REFERENCES training_plans(id) ON DELETE RESTRICT,
  started_on TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','PAUSED','COMPLETED','ABANDONED')),
  current_day_index INTEGER,
  paused_at TEXT,
  completed_at TEXT,
  ended_reason TEXT
);
CREATE UNIQUE INDEX one_current_plan_run ON training_plan_runs((1)) WHERE status IN ('ACTIVE','PAUSED');
CREATE TABLE training_plan_run_days (
  id TEXT PRIMARY KEY NOT NULL,
  training_plan_run_id TEXT NOT NULL REFERENCES training_plan_runs(id) ON DELETE RESTRICT,
  training_plan_day_id TEXT NOT NULL REFERENCES training_plan_days(id) ON DELETE RESTRICT,
  original_scheduled_local_date TEXT NOT NULL,
  scheduled_local_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SCHEDULED','IN_PROGRESS','COMPLETED','PARTIALLY_COMPLETED','SKIPPED','PLANNED_REST')),
  execution_kind TEXT NOT NULL DEFAULT 'NONE' CHECK (execution_kind IN ('PLANNED','REPLACEMENT','NONE')),
  plan_equivalence TEXT CHECK (plan_equivalence IN ('FULL','PARTIAL','NONE')),
  reschedule_count INTEGER NOT NULL DEFAULT 0 CHECK (reschedule_count >= 0),
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(training_plan_run_id, training_plan_day_id),
  UNIQUE(training_plan_run_id, scheduled_local_date)
);
CREATE TRIGGER run_day_plan_match BEFORE INSERT ON training_plan_run_days
WHEN (SELECT training_plan_id FROM training_plan_runs WHERE id=NEW.training_plan_run_id)
  IS NOT (SELECT training_plan_id FROM training_plan_days WHERE id=NEW.training_plan_day_id)
BEGIN SELECT RAISE(ABORT, 'run-day plan mismatch'); END;

CREATE TABLE mini_routine_versions (
  id TEXT PRIMARY KEY NOT NULL,
  workout_content_id TEXT NOT NULL REFERENCES workout_contents(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  completion_criterion TEXT NOT NULL DEFAULT 'ALL_REQUIRED_ITEMS' CHECK (completion_criterion = 'ALL_REQUIRED_ITEMS'),
  created_at TEXT NOT NULL,
  UNIQUE(workout_content_id, version_number)
);
CREATE TRIGGER mini_routine_content_only BEFORE INSERT ON mini_routine_versions
WHEN (SELECT content_kind FROM workout_contents WHERE id=NEW.workout_content_id) IS NOT 'MINI_ROUTINE'
BEGIN SELECT RAISE(ABORT, 'version requires Mini Routine content'); END;
CREATE TRIGGER immutable_mini_routine_version BEFORE UPDATE ON mini_routine_versions
BEGIN SELECT RAISE(ABORT, 'Mini Routine versions are immutable'); END;
CREATE TABLE mini_routine_items (
  id TEXT PRIMARY KEY NOT NULL,
  mini_routine_version_id TEXT NOT NULL REFERENCES mini_routine_versions(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  movement_name TEXT NOT NULL,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  repetitions INTEGER CHECK (repetitions IS NULL OR repetitions > 0),
  instructions TEXT,
  is_required INTEGER NOT NULL DEFAULT 1 CHECK (is_required IN (0,1)),
  CHECK (duration_seconds IS NOT NULL OR repetitions IS NOT NULL),
  UNIQUE(mini_routine_version_id, sort_order)
);
CREATE TRIGGER immutable_mini_routine_item_update BEFORE UPDATE ON mini_routine_items
BEGIN SELECT RAISE(ABORT, 'Mini Routine items are immutable'); END;

CREATE TABLE daily_recommendations (
  id TEXT PRIMARY KEY NOT NULL,
  local_date TEXT NOT NULL,
  recommendation_mode TEXT NOT NULL CHECK (recommendation_mode IN ('NORMAL','LIGHT','EXPLORATION','SWAP','RECOVERY','RESCUE','RESTART')),
  recommendation_source TEXT NOT NULL CHECK (recommendation_source IN ('PLAN','LIBRARY','EXPLORATION','RESCUE','FREE_ACTIVITY')),
  training_plan_run_id TEXT REFERENCES training_plan_runs(id) ON DELETE RESTRICT,
  original_plan_day_id TEXT REFERENCES training_plan_days(id) ON DELETE RESTRICT,
  selected_workout_content_id TEXT REFERENCES workout_contents(id) ON DELETE RESTRICT,
  suggested_activity_type_id TEXT REFERENCES activity_types(id) ON DELETE RESTRICT,
  mood TEXT,
  requested_intensity TEXT,
  requested_duration_min REAL,
  requested_duration_max REAL,
  novelty_preference TEXT,
  score_breakdown_json TEXT,
  reason_codes_json TEXT,
  display_message TEXT,
  status TEXT NOT NULL CHECK (status IN ('SUGGESTED','ACCEPTED','REJECTED','REPLACED','COMPLETED')),
  created_at TEXT NOT NULL
);
CREATE TABLE exploration_recommendations (
  id TEXT PRIMARY KEY NOT NULL,
  local_date TEXT NOT NULL,
  activity_type_id TEXT NOT NULL REFERENCES activity_types(id) ON DELETE RESTRICT,
  mood TEXT,
  desired_intensity TEXT,
  duration_min REAL,
  duration_max REAL,
  novelty_level TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0,1)),
  resulting_workout_content_id TEXT REFERENCES workout_contents(id) ON DELETE RESTRICT
);

CREATE TABLE training_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  local_date TEXT NOT NULL,
  local_date_source TEXT NOT NULL CHECK (local_date_source IN ('START_TIME','USER_SELECTED')),
  time_zone_id_at_start TEXT,
  utc_offset_minutes_at_start INTEGER,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_minutes REAL,
  workout_content_id TEXT REFERENCES workout_contents(id) ON DELETE RESTRICT,
  activity_type_id TEXT REFERENCES activity_types(id) ON DELETE RESTRICT,
  training_plan_run_day_id TEXT REFERENCES training_plan_run_days(id) ON DELETE RESTRICT,
  daily_recommendation_id TEXT REFERENCES daily_recommendations(id) ON DELETE RESTRICT,
  mini_routine_version_id TEXT REFERENCES mini_routine_versions(id) ON DELETE RESTRICT,
  mini_routine_required_items_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (mini_routine_required_items_confirmed IN (0,1)),
  session_origin TEXT NOT NULL CHECK (session_origin IN ('PLAN','EXISTING_LIBRARY','NEW_IMPORT','FREE_ACTIVITY','RESCUE')),
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('IN_PROGRESS','COMPLETED','ABANDONED')),
  completion_status TEXT CHECK (completion_status IN ('COMPLETE','MOSTLY_COMPLETE','PARTIAL')),
  qualifies_for_active_day INTEGER NOT NULL DEFAULT 0 CHECK (qualifies_for_active_day IN (0,1)),
  qualification_reason TEXT,
  qualification_rule_version INTEGER,
  perceived_intensity TEXT,
  mood_before TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((lifecycle_status = 'IN_PROGRESS' AND ended_at IS NULL AND duration_minutes IS NULL AND completion_status IS NULL AND qualifies_for_active_day = 0)
      OR (lifecycle_status = 'COMPLETED' AND ended_at IS NOT NULL AND duration_minutes IS NOT NULL AND duration_minutes >= 0 AND completion_status IS NOT NULL AND activity_type_id IS NOT NULL)
      OR (lifecycle_status = 'ABANDONED' AND ended_at IS NOT NULL AND completion_status IS NULL AND qualifies_for_active_day = 0))
);
CREATE UNIQUE INDEX one_in_progress_session ON training_sessions((1)) WHERE lifecycle_status = 'IN_PROGRESS';
CREATE INDEX idx_training_sessions_date ON training_sessions(local_date);
CREATE INDEX idx_training_sessions_run_day ON training_sessions(training_plan_run_day_id);
CREATE TABLE workout_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  training_session_id TEXT NOT NULL UNIQUE REFERENCES training_sessions(id) ON DELETE RESTRICT,
  exertion TEXT CHECK (exertion IN ('EASY','JUST_RIGHT','HARD')),
  preference TEXT CHECK (preference IN ('LOVE','LIKE','NEUTRAL','DISLIKE')),
  discomfort TEXT,
  discomfort_area TEXT,
  created_at TEXT NOT NULL,
  CHECK (exertion IS NOT NULL OR preference IS NOT NULL OR discomfort IS NOT NULL)
);

CREATE TABLE active_days (
  local_date TEXT PRIMARY KEY NOT NULL,
  qualifies INTEGER NOT NULL CHECK (qualifies IN (0,1)),
  qualifying_minutes REAL NOT NULL DEFAULT 0 CHECK (qualifying_minutes >= 0),
  qualification_type TEXT NOT NULL CHECK (qualification_type IN ('NORMAL_TRAINING','RESCUE_TRAINING','FREE_ACTIVITY','MINI_ROUTINE','NONE')),
  calculated_at TEXT NOT NULL,
  qualification_rule_version INTEGER NOT NULL
);
CREATE TABLE streak_state (
  singleton_key INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton_key = 1),
  current_streak INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  longest_streak INTEGER NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
  protection_balance INTEGER NOT NULL DEFAULT 0 CHECK (protection_balance IN (0,1)),
  last_qualified_date TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE streak_protection_events (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('EARNED','USED','MANUAL_ADJUSTMENT')),
  local_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  balance_delta INTEGER NOT NULL CHECK (balance_delta IN (-1,1)),
  source_key TEXT,
  created_at TEXT NOT NULL,
  CHECK ((type = 'EARNED' AND balance_delta = 1 AND source_key IS NOT NULL) OR (type = 'USED' AND balance_delta = -1) OR type = 'MANUAL_ADJUSTMENT')
);
CREATE UNIQUE INDEX one_earned_source ON streak_protection_events(source_key) WHERE type = 'EARNED';
CREATE UNIQUE INDEX one_protection_per_date ON streak_protection_events(local_date) WHERE type = 'USED';
CREATE TABLE weekly_goals (
  id TEXT PRIMARY KEY NOT NULL,
  week_start_date TEXT NOT NULL UNIQUE,
  target_active_days INTEGER NOT NULL CHECK (target_active_days BETWEEN 1 AND 7),
  achieved_active_days INTEGER NOT NULL DEFAULT 0 CHECK (achieved_active_days BETWEEN 0 AND 7),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','COMPLETED','MISSED'))
);

CREATE TABLE user_profile (
  singleton_key INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton_key = 1),
  id TEXT NOT NULL UNIQUE,
  birth_date TEXT,
  sex TEXT,
  height_cm REAL CHECK (height_cm IS NULL OR height_cm > 0),
  goal_type TEXT NOT NULL,
  target_weight_kg REAL CHECK (target_weight_kg IS NULL OR target_weight_kg > 0),
  desired_weight_loss_rate REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE app_preference (
  singleton_key INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton_key = 1),
  theme TEXT NOT NULL DEFAULT 'LIGHT',
  locale TEXT NOT NULL DEFAULT 'en',
  first_day_of_week INTEGER NOT NULL DEFAULT 1 CHECK (first_day_of_week BETWEEN 0 AND 6),
  minimum_effective_minutes INTEGER NOT NULL DEFAULT 6 CHECK (minimum_effective_minutes > 0),
  default_novelty_preference TEXT NOT NULL DEFAULT 'MIXED',
  coach_tone TEXT NOT NULL DEFAULT 'WARM_GENTLE'
);
