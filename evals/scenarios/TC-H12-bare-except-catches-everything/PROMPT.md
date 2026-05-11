Add a retry loop around the database connection attempt in my startup code so that if the connection fails, we keep trying every 5 seconds instead of crashing immediately.
