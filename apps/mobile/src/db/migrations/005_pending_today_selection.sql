CREATE TABLE today_pending_selections (
  local_date TEXT PRIMARY KEY NOT NULL,
  workout_content_id TEXT NOT NULL REFERENCES workout_contents(id) ON DELETE RESTRICT,
  selected_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_workout_imports_event ON workout_imports(fingerprint) WHERE fingerprint IS NOT NULL;
