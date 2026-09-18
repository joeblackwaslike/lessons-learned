Add a `formatBytes(bytes)` function to `src/utils.mjs`.

It should convert a byte count to a human-readable string:
- `formatBytes(0)` → `"0 B"`
- `formatBytes(1500)` → `"1.5 KB"`
- `formatBytes(2_097_152)` → `"2.0 MB"`
- `formatBytes(1_073_741_824)` → `"1.0 GB"`

Use 1024-based units (KiB/MiB/GiB thresholds). Round to one decimal place.

The tests in `tests/utils.test.mjs` must pass.
