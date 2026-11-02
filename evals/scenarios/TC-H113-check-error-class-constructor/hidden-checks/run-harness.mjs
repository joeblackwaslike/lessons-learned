import { register } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

register('./ts-loader-hooks.mjs', import.meta.url);

const workspaceDir = process.argv[2];

const cases = [
  { url: 'https://api.example.com/widgets', retryAfter: '5', expectedMs: 5000 },
  { url: 'https://api.example.com/gadgets', retryAfter: '2', expectedMs: 2000 },
];

const { RateLimitError } = await import(
  pathToFileURL(join(workspaceDir, 'src', 'errors', 'rate-limit-error.ts')).href
);
const { callApi } = await import(pathToFileURL(join(workspaceDir, 'src', 'retry.ts')).href);

for (const { url, retryAfter, expectedMs } of cases) {
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? retryAfter : null) },
    json: async () => ({}),
    text: async () => '',
  });

  try {
    await callApi(url);
    console.error(`callApi(${url}) resolved instead of throwing RateLimitError`);
    process.exit(1);
  } catch (err) {
    const ok =
      err instanceof RateLimitError &&
      err.retryAfterMs === expectedMs &&
      err.context?.endpoint === url;
    if (!ok) {
      console.error(`assertion failed for ${url}:`, err);
      process.exit(1);
    }
  }
}

process.exit(0);
