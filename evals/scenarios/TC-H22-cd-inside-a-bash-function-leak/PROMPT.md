I process several project directories in sequence. Write a bash script `run.sh` with a `process_project` function that takes a project directory (a relative path), `cd`s into it, and runs the build step: write the number of lines in that project's `input.txt` to a file `built.txt` inside the same project directory. Then call `process_project` for each directory in `PROJECTS=(proj-a proj-b proj-c)`.

Run `run.sh` from the workspace root and confirm every project gets built.
