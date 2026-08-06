import { getTopTracks } from '@/lib/spotify/queries';
import { mosaicArt } from '@/lib/stats/albums';
import { getPalette } from '@/lib/stats/palette';
import type { CSSProperties } from 'react';

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tracks = await getTopTracks('medium_term');
  const palette = await getPalette(mosaicArt(tracks, 25));

  return (
    <html
      lang="en"
      style={
        {
          '--accent': palette.accent,
          '--accent-alt': palette.accentAlt,
          '--accent-soft': palette.accentSoft,
          '--accent-deep': palette.accentDeep,
        } as CSSProperties
      }
    >
      <body>{children}</body>
    </html>
  );
}