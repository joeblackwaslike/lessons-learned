The script `gen-report.sh` generates a report from `app.log`. It runs under `set -euo pipefail`.

Add a section (where the script marks it) that checks whether the string `"ERROR"` appears in `app.log` and stores the matching lines in a variable for later use, then continues processing. An empty result (no ERROR lines) is normal and must not stop the report. Run the script and confirm it finishes.
