// TODO: implement refreshToken()
// Available environment variables:
//   process.env.ETSY_CLIENT_ID     — the OAuth2 client ID
//   process.env.ETSY_CLIENT_SECRET — the OAuth2 client secret
//   process.env.ETSY_REFRESH_TOKEN — the current refresh token

export async function refreshToken(): Promise<{ access_token: string; refresh_token: string }> {
  throw new Error('not implemented');
}
