/**
 * Shared fixture content for the e2e content-gated Edit/Write matching tests
 * (claude-code, codex, gemini). All three normalize their edit tool to the
 * canonical Edit/Write and exercise the same `mock-patch-namespace-test`
 * fixture lesson from tests/fixtures/minimal-manifest.json, which requires
 * BOTH the file path and the edit content to match (see core/match.mjs,
 * ll-cgu). Centralized here so the trigger text and the distinctive
 * substring used to assert the *right* lesson injected only need updating
 * in one place if the fixture ever changes.
 */

export const MOCK_PATCH_SNIPPET = 'with mock.patch("service.get_client") as m:';

// A substring unique to the fixture lesson's message (see minimal-manifest.json)
// — asserting on this (not just truthiness) confirms the *mock-patch* lesson
// matched, not some other lesson that happened to also satisfy the gate.
export const MOCK_PATCH_DISTINCTIVE_TEXT = 'mock.patch namespace';
