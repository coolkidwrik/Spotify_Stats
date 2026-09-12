import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import './globals.css';
 
import { getMosaicArt } from '@/lib/mosaic';
import { getPalette, fallbackPalette } from '@/lib/stats/palette';
 
import Header from '@/components/layout/header';
import Footer from '@/components/layout/footer';
 
export const metadata: Metadata = {
  title: "CKWrik's Spotify Stats",
  description: 'What I have been listening to, pulled live from Spotify.',
};
 
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /**
   * Guarded on purpose. getPalette depends on sharp, whose native binaries
   * come from npm install scripts — and the build log warns those aren't
   * explicitly allowed. If sharp ever fails to load, an unguarded call here
   * would throw in the ROOT layout and take down every page: far too large a
   * blast radius for a decorative colour.
   *
   * Same call page.tsx makes, so it hits the same cache entry and the palette
   * always describes the exact covers shown in the mosaic.
   */
  let palette = fallbackPalette;
  try {
    const art = await getMosaicArt(25);
    palette = await getPalette(art);
  } catch (err) {
    console.error('[layout] palette unavailable, using fallback:', err);
  }
 
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