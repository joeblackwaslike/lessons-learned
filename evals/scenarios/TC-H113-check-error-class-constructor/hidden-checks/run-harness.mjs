import { register } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

register('./ts-loader-hooks.mjs', import.meta.url);

const workspaceDir = process.argv[2];
const url = 'https://api.example.com/widgets';

globalThis.fetch = async () => ({
  ok: false,
  status: 429,
  headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? '5' : null) },
  json: async () => ({}),
  text: async () => '',
});

const { RateLimitError } = await import(
  pathToFileURL(join(workspaceDir, 'src', 'errors', 'rate-limit-error.ts')).href
);
const { callApi } = await import(pathToFileURL(join(workspaceDir, 'src', 'retry.ts')).href);

try {
  await callApi(url);
  process.exit(1);
} catch (err) {
  const ok =
    err instanceof RateLimitError &&
    typeof err.retryAfterMs === 'number' &&
    typeof err.context?.endpoint === 'string' &&
    err.context.endpoint.length > 0;
  process.exit(ok ? 0 : 1);
}
