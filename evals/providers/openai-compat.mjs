/**
 * Promptfoo custom provider: OpenAI-compatible agent endpoint.
 * For future use with z.ai, Kimi K2, or any provider exposing an OpenAI-compat API.
 *
 * Phase 1: placeholder — implement when a third provider target is identified.
 */

export default class OpenAICompatProvider {
  constructor(options = {}) {
    this.model = options.model ?? 'gpt-4o';
    this.baseUrl = options.baseUrl;
  }

  id() {
    return 'openai-compat-agent';
  }

  async callApi(_prompt, _context, _options) {
    throw new Error('openai-compat provider not yet implemented');
  }
}
