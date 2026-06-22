#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="app.log"

echo "Generating report from ${LOG_FILE}..."

line_count=$(wc -l <"$LOG_FILE")
echo "Scanned ${line_count} log lines."

# (Add the ERROR-check section here.)

echo "REPORT_DONE"
