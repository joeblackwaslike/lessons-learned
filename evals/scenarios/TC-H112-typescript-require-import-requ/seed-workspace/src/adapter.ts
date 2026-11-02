const snoowrap = require('snoowrap');

export function createRedditClient(config: Record<string, string>) {
  return new snoowrap(config);
}
