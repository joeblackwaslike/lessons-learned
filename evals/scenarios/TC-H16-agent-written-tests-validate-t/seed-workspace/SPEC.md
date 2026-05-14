# cache_results Feature Spec

## Behavior

When `cache_results=True` is passed to `fetch_data`:

1. On the first call with a given `(url, params)` combination, fetch from the API normally.
2. On subsequent calls with the **same** `(url, params)`, return the **cached result** —
   do NOT make a new network request.
3. The cache must persist across multiple function invocations within the same process
   (i.e., a module-level or instance-level cache, not a local variable).
4. When `cache_results=False` (the default), behavior is unchanged — always fetch live.

## Acceptance Criteria

- `fetch_data(url, params, cache_results=True)` called twice with identical args must
  return the same object (identity `is`, not just equality `==`).
- A mock/spy on the HTTP layer must show exactly 1 network call for 2 identical cached calls.
- Calling with `cache_results=False` must NOT use the cache.
