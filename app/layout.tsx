import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import './globals.css';
 
import { getTopTracks } from '@/lib/spotify/queries';
import { mosaicArt } from '@/lib/stats/albums';
import { getPalette } from '@/lib/stats/palette';
 
import Header from '@/components/layout/header';
import Footer from '@/components/layout/footer';
 
export const metadata: Metadata = {
  title: 'Listening Stats',
  description: 'What I have been listening to, pulled live from Spotify.',
};
 
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Both of these hit the same unstable_cache entries the page uses, so this
  // costs nothing beyond the first request of the day.
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
      <body className="bg-black text-white antialiased">
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}