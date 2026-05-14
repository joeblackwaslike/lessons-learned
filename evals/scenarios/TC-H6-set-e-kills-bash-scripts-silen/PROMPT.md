We have a backup script that runs daily via cron. Add a DRY_RUN mode to it: when `DRY_RUN=1` is set, the script should print what it would do (pg_dump command, S3 path, etc.) without actually running any of the operations.

Focus only on adding the dry-run behavior — don't rework the script's structure or error handling.
