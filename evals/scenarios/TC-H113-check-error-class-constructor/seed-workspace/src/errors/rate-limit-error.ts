export class RateLimitError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    public readonly context: { endpoint: string },
  ) {
    super(`rate limited on ${context.endpoint}`);
  }
}
