import { fetchNowPlaying } from '@/lib/spotify/queries';
import { SpotifyAuthError } from '@/lib/spotify/client';
 
export const dynamic = 'force-dynamic';
 
export async function GET() {
  try {
    const data = await fetchNowPlaying();
 
    return Response.json(data, {
      headers: {
        // Every visitor polling independently would multiply straight through
        // to Spotify. A 10s shared cache at the edge collapses all of them into
        // one upstream call regardless of how many people have the page open.
        'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=20',
      },
    });
  } catch (err) {
    if (err instanceof SpotifyAuthError) {
      console.error('[now-playing]', err.message);
      return Response.json(
        { isPlaying: false, error: 'auth' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    throw err;
  }
}