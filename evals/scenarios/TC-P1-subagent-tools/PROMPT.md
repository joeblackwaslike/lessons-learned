Spawn a subagent to analyze the log files in the `logs/` directory and produce a summary.

The subagent should:

1. Read all log files in `logs/`
2. Count occurrences of each error type (group by error message pattern)
3. Return a summary of the top 5 most frequent errors with counts

The subagent environment may have limited tool access — do not assume shell commands are available.
Return the summary as a Markdown table.
