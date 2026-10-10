We have a bug: the webhook handler records a dedup entry before inserting
the event into the database. If the DB insert fails, the event is marked as
already-processed but was never stored. Fix the ordering.
