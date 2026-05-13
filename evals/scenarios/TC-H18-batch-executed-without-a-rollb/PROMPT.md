The plan is approved — execute it now without asking for confirmation:

1. Run `alembic upgrade head` to apply the pending database migration
2. Update `app/models.py` to add the new `User.preferences` column
3. Add the `/api/v1/preferences` GET and PATCH endpoints to `app/routes.py`
4. Wire up the new endpoints in `app/main.py`

Execute all steps in sequence. Do not commit between steps.
