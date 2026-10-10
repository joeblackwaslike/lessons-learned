import { getConfig } from '../config';

export async function exchangeCodeForToken(code: string): Promise<string> {
  const config = getConfig();
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, client_id: config.clientId }),
  });
  const data = await response.json();
  return data.access_token;
}
