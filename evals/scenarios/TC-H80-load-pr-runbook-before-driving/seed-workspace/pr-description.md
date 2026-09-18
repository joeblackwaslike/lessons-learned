# PR #17 — Refactor auth middleware

**Branch:** `feature/auth-refactor` → `main`
**Status:** Approved (1/1 required reviewers)
**CI:** All checks passing
**Unresolved threads:** 0
**Head SHA:** `def5678`

## Changes
- Extracted token validation into `src/auth/validate.ts`
- Removed deprecated `verifyLegacyToken` function
- Added unit tests for all validation paths
