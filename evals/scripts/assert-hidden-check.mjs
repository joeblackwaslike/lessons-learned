/**
 * Promptfoo file-based JS assertion: passes if the provider's hiddenCheck returned pass=true.
 * Used by treatment arm tests to verify lesson effectiveness.
 *
 * Note: Promptfoo v0.121 exposes the custom provider response at context.providerResponse,
 * not context.response. context.response is the internal response object (empty for file://
 * custom providers).
 *
 * @param {string} output - agent text output (unused; check is in provider metadata)
 * @param {object} context - Promptfoo assertion context
 * @returns {boolean}
 */
export default function assertHiddenCheckPass(output, context) {
  return context.providerResponse?.metadata?.hiddenCheck?.pass === true;
}
