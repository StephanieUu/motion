ALTER TABLE app_preference ADD COLUMN rescue_notifications_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (rescue_notifications_enabled IN (0,1));
ALTER TABLE app_preference ADD COLUMN rescue_local_minute_of_day INTEGER
  CHECK (rescue_local_minute_of_day IS NULL OR rescue_local_minute_of_day BETWEEN 0 AND 1439);
