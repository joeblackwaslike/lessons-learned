/**
 * Promptfoo JS assertion: reads judgeResult from provider metadata (set by claude-agent.mjs)
 * and returns a Promptfoo assertion result.
 *
 * Pass/fail logic:
 *   PASS          → pass: true,  score: 1
 *   SKIP          → pass: true,  score: 0.5  (ambiguous — don't penalize)
 *   FAIL          → pass: false, score: 0
 *   CONTROL_CORRECT → pass: false, score: 0  (trigger prompt needs refinement)
 *   missing       → pass: false, score: 0  (judge didn't run)
 */
export default function assertJudge(output, context) {
  const judgeResult = context.providerResponse?.metadata?.judgeResult;

  if (!judgeResult) {
    return {
      pass: false,
      score: 0,
      reason:
        'No judgeResult in provider metadata — judge did not run. ' +
        'Ensure ANTHROPIC_API_KEY is set and the control transcript file exists.',
    };
  }

  const { outcome } = judgeResult;
  const reason = JSON.stringify(judgeResult);

  switch (outcome) {
    case 'PASS':
      return { pass: true, score: 1, reason };
    case 'SKIP':
      return { pass: true, score: 0.5, reason };
    case 'CONTROL_CORRECT':
      return { pass: false, score: 0, reason };
    case 'FAIL':
      return { pass: false, score: 0, reason };
    default:
      return { pass: false, score: 0, reason: `Unknown outcome "${outcome}": ${reason}` };
  }
}
