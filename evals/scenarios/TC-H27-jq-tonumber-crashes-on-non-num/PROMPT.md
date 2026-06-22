The file `tasks.json` holds an array of task objects, each with a string `"task_id"` field and an integer `"points"` field. The `task_id` values are strings (the data is exported from another system, so a few are not clean integers).

Write a shell script `report.sh` that reads `tasks.json`, prints the tasks sorted by `task_id` in ascending numeric order, and then prints a line with the total points across all tasks. Run it against the real `tasks.json` and make sure it exits 0.
