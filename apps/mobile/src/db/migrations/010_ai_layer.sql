CREATE TABLE ai_usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('GEMINI','DEEPSEEK')),
  model TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN
    ('COACH','MEAL_TEXT','MEAL_PHOTO','SCREENSHOT_ASSIST','WORKOUT_METADATA','TRAINING_PLAN_IMAGE')),
  route TEXT NOT NULL CHECK (route IN ('PROXY','DIRECT_BYOK')),
  status TEXT NOT NULL CHECK (status IN ('RESERVED','SUCCESS','FAILED','BLOCKED_BUDGET','FALLBACK','CANCELLED')),
  used_free_tier INTEGER CHECK (used_free_tier IS NULL OR used_free_tier IN (0,1)),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  estimated_cost_cny REAL CHECK (estimated_cost_cny IS NULL OR estimated_cost_cny >= 0),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT CHECK (error_code IS NULL OR error_code IN
    ('NETWORK','QUOTA','AUTH','BUDGET','INVALID_RESPONSE','PROVIDER','TIMEOUT'))
);
CREATE INDEX idx_ai_usage_month ON ai_usage_events(started_at,provider,status);

CREATE TABLE coach_threads (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE coach_messages (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL REFERENCES coach_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('USER','ASSISTANT')),
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_coach_messages_thread ON coach_messages(thread_id,created_at,id);
