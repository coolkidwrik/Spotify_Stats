import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import './globals.css';
 
import { getMosaicArt } from '@/lib/mosaic';
import { getPalette } from '@/lib/stats/palette';
 
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
  // Same call page.tsx makes, so the palette always describes the exact covers
  // shown in the mosaic. getPalette is keyed on this URL list, so when the
  // covers change the palette recomputes automatically.
  const art = await getMosaicArt(25);
  const palette = await getPalette(art);
 
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
 