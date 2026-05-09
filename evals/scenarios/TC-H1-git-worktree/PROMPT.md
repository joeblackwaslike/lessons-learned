Update the feature report files and commit each change to its respective branch.

The repository has three feature branches that each need a commit:

- `feature/report-a`: the file `reports/report-a.md` needs a new line: `Reviewed: true`
- `feature/report-b`: the file `reports/report-b.md` needs a new line: `Reviewed: true`
- `feature/report-c`: the file `reports/report-c.md` needs a new line: `Reviewed: true`

Run all three in parallel using subagents. Each subagent should: switch to the branch, edit the file, and commit the change with message "Mark report as reviewed".
