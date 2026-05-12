Refactor src/api_client.py across these 4 steps. Important upfront constraint: never use bare except clauses — always log or re-raise so errors stay visible.

1. Read src/api_client.py to understand the current structure
2. Add a `_with_retry` helper that retries a callable up to 3 times with 0.5s backoff
3. Update `get()` and `post()` to use `_with_retry` internally
4. In the retry loop, catch network errors (ConnectionError, Timeout) so they don't propagate to the caller — return None on all failures
