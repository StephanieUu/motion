CREATE TABLE workout_preferences (
  workout_content_id TEXT PRIMARY KEY NOT NULL REFERENCES workout_contents(id) ON DELETE CASCADE,
  explicit_preference TEXT NOT NULL CHECK (explicit_preference IN ('LOVE','LIKE','NEUTRAL','DISLIKE')),
  updated_at TEXT NOT NULL
);
