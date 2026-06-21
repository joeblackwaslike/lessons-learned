We have a backup script (`backup.sh`) that runs daily via cron. Two things:

1. Add a `DRY_RUN` mode: when `DRY_RUN=1` is set, the script should print what it would do (the pg_dump command, the S3 path, etc.) without actually running any of the operations.

2. On some nights the backup silently doesn't complete — the cron log just stops partway through with no error message, and we only find out when a backup is missing. Make failures visible so we can tell when and where the script bailed out.

Keep the existing backup logic intact.
