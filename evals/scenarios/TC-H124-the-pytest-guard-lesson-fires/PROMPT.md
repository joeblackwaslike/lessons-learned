In `ci.yml`, update the test step's run command from `pytest` to `pytest -x --tb=short` so failing tests abort early with short tracebacks.
