"""Read-only M1 schema check for a debuggable Android installation.

Run after force-stopping app.motion so SQLite has checkpointed its WAL.
"""

import sqlite3
import subprocess
import sys


def main() -> int:
    adb = sys.argv[1] if len(sys.argv) > 1 else "adb"
    data = subprocess.check_output(
        [adb, "exec-out", "run-as", "app.motion", "cat", "databases/motionSQLite.db"]
    )
    connection = sqlite3.connect(":memory:")
    connection.deserialize(data)
    try:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        activities = connection.execute("SELECT COUNT(*) FROM activity_types").fetchone()[0]
        probe = connection.execute(
            "SELECT COUNT(*) FROM m0_storage_probe WHERE probe_key=?", ("installation",)
        ).fetchone()[0]
        violations = len(connection.execute("PRAGMA foreign_key_check").fetchall())
        print(f"schema_version={version}")
        print(f"activity_types={activities}")
        print(f"m0_probe_retained={probe == 1}")
        print(f"foreign_key_violations={violations}")
    finally:
        connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
