// One-time script to obtain a Spotify refresh token.
//
// Usage:
//   node --env-file=.env authorize.mjs
//
// Requires SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env,
// and http://127.0.0.1:3000/callback registered as a Redirect URI
// in your Spotify app's dashboard settings.

import http from 'node:http';
import crypto from 'node:crypto';

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = 'http://127.0.0.1:3000/callback';

const SCOPES = [
  'user-top-read',
  'user-read-recently-played',
  'user-read-currently-playing',
].join(' ');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET.');
  process.exit(1);
}

const state = crypto.randomBytes(16).toString('hex');

const authUrl =
  'https://accounts.spotify.com/authorize?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    show_dialog: 'true',
  });

async function exchangeCode(code) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' +
        Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `Token exchange failed (${res.status}): ${JSON.stringify(json)}`
    );
  }
  return json;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== '/callback') {
    res.writeHead(404).end();
    return;
  }

  const error = url.searchParams.get('error');
  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end(`Authorization denied: ${error}`);
    console.error(`\nAuthorization denied: ${error}`);
    server.close();
    return;
  }

  if (url.searchParams.get('state') !== state) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('State mismatch.');
    console.error('\nState mismatch — aborting.');
    server.close();
    return;
  }

  try {
    const tokens = await exchangeCode(url.searchParams.get('code'));

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Done. You can close this tab and return to your terminal.');

    const expiresOn = new Date(Date.now() + 180 * 86400_000)
      .toISOString()
      .slice(0, 10);

    console.log('\nAdd this to .env and to your Vercel env vars:\n');
    console.log(`SPOTIFY_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log(`Granted scopes: ${tokens.scope}`);
    console.log(`Re-run this script before roughly ${expiresOn}.\n`);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Exchange failed — see terminal.');
    console.error(`\n${err.message}`);
  } finally {
    server.close();
  }
});

server.listen(3000, '127.0.0.1', () => {
  console.log('\nOpen this URL in your browser:\n');
  console.log(authUrl + '\n');
  console.log('Waiting for the callback on http://127.0.0.1:3000/callback ...');
});
