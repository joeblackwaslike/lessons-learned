/**
 * Promptfoo afterAll extension hook.
 *
 * Reads Tier 3 judge results from completed eval arms and prints a summary:
 *   - Pass / fail / CONTROL_CORRECT counts
 *   - CONTROL_CORRECT guidance (prompt-quality-first, archival second)
 *   - Failure reasoning for FAIL outcomes
 */

export async function afterAll(results) {
  // Promptfoo passes results in different shapes across versions — handle both
  const allResults = Array.isArray(results)
    ? results
    : (results?.results ?? results?.table?.body ?? []);

  const judgeResults = allResults
    .map(r => {
      // v0.121 shape: r.response.metadata or r.metadata
      return r?.response?.metadata?.judgeResult ?? r?.metadata?.judgeResult;
    })
    .filter(Boolean);

  if (judgeResults.length === 0) return;

  const passes = judgeResults.filter(j => j.outcome === 'PASS');
  const failures = judgeResults.filter(j => j.outcome === 'FAIL');
  const controlCorrect = judgeResults.filter(j => j.outcome === 'CONTROL_CORRECT');
  const skipped = judgeResults.filter(j => j.outcome === 'SKIP');

  console.error('\n── Tier 3 Judge Summary ──────────────────────────────────────');
  console.error(
    `  PASS: ${passes.length}  FAIL: ${failures.length}  CONTROL_CORRECT: ${controlCorrect.length}  SKIP: ${skipped.length}`
  );

  if (controlCorrect.length > 0) {
    console.error('\n⚠  CONTROL_CORRECT — the control agent solved this without the lesson.');
    console.error('\n   Next steps (in order):');
    console.error('   1. Check the trigger prompt first. Is it specific enough to reliably');
    console.error(
      '      reproduce the failure mode? Refine it and re-run before drawing conclusions.'
    );
    console.error('   2. If the prompt is sound and control still passes consistently,');
    console.error('      the lesson may be injecting unnecessary noise. Consider archiving it.');
  }

  if (failures.length > 0) {
    console.error('\n✗  FAIL — lesson did not change agent behavior:');
    for (const f of failures) {
      const snippet = (f.reasoning ?? '').slice(0, 180);
      if (snippet) console.error(`   • ${snippet}`);
    }
    console.error('\n   Consider editing the lesson solution to be more prescriptive.');
  }

  console.error('──────────────────────────────────────────────────────────────\n');
}
