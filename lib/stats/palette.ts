// lib/stats/palette.ts
import 'server-only';
import { unstable_cache } from 'next/cache';
import sharp from 'sharp';

export interface Palette {
  /** Mid-lightness accent, readable on both light and dark backgrounds. */
  accent: string;
  /** Second-most vibrant colour, for secondary highlights. */
  accentAlt: string;
  /** Very light tint of the accent — background fills in light mode. */
  accentSoft: string;
  /** Dark shade of the accent — text on light tints, borders. */
  accentDeep: string;
  /** All extracted centroids, unclamped, most dominant first. */
  raw: string[];
}

const FALLBACK: Palette = {
  accent: '#6366f1',
  accentAlt: '#8b5cf6',
  accentSoft: '#eef0fe',
  accentDeep: '#312e81',
  raw: ['#6366f1'],
};

type RGB = [number, number, number];

// ---------------------------------------------------------------------------
// Colour conversion
// ---------------------------------------------------------------------------

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function rgbToHex([r, g, b]: RGB): string {
  return (
    '#' +
    [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  );
}

// ---------------------------------------------------------------------------
// Quantization
//
// Plain k-means in RGB space. Not perceptually ideal (Lab would be better) but
// good enough on 8x8 downsamples, and it has no dependencies. Initialization is
// deterministic — no Math.random — so the same covers always produce the same
// palette across rebuilds.
// ---------------------------------------------------------------------------

function dist2(a: RGB, b: RGB): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function kmeans(
  pixels: RGB[],
  k: number,
  iterations = 12
): { color: RGB; count: number }[] {
  if (pixels.length <= k) {
    return pixels.map((p) => ({ color: p, count: 1 }));
  }

  // Seed with the middle pixel, then repeatedly take the point farthest from
  // any existing centroid. Spreads seeds across the colour space.
  const centroids: RGB[] = [pixels[Math.floor(pixels.length / 2)]];
  while (centroids.length < k) {
    let best = pixels[0];
    let bestDist = -1;
    for (const p of pixels) {
      let nearest = Infinity;
      for (const c of centroids) nearest = Math.min(nearest, dist2(p, c));
      if (nearest > bestDist) {
        bestDist = nearest;
        best = p;
      }
    }
    centroids.push(best);
  }

  let assignments = new Array(pixels.length).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;

    for (let i = 0; i < pixels.length; i++) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = dist2(pixels[i], centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = c;
        }
      }
      if (assignments[i] !== bestIdx) {
        assignments[i] = bestIdx;
        moved = true;
      }
    }

    if (!moved && iter > 0) break;

    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pixels.length; i++) {
      const s = sums[assignments[i]];
      s[0] += pixels[i][0];
      s[1] += pixels[i][1];
      s[2] += pixels[i][2];
      s[3] += 1;
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c][3] === 0) continue;
      centroids[c] = [
        sums[c][0] / sums[c][3],
        sums[c][1] / sums[c][3],
        sums[c][2] / sums[c][3],
      ];
    }
  }

  const counts = new Array(centroids.length).fill(0);
  for (const a of assignments) counts[a]++;

  return centroids
    .map((color, i) => ({ color, count: counts[i] }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

async function samplePixels(url: string): Promise<RGB[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());

  // Downscaling to 8x8 acts as a cheap box blur — it removes JPEG noise and
  // leaves 64 pixels that genuinely represent the cover's colour regions.
  const { data } = await sharp(buf)
    .resize(8, 8, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels: RGB[] = [];
  for (let i = 0; i + 2 < data.length; i += 3) {
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  return pixels;
}

async function collectPixels(urls: string[]): Promise<RGB[]> {
  const pixels: RGB[] = [];
  const CHUNK = 5;

  for (let i = 0; i < urls.length; i += CHUNK) {
    const results = await Promise.allSettled(
      urls.slice(i, i + CHUNK).map(samplePixels)
    );
    for (const r of results) {
      if (r.status === 'fulfilled') pixels.push(...r.value);
      else console.warn('[palette] skipped an image:', r.reason?.message);
    }
  }

  return pixels;
}

// ---------------------------------------------------------------------------
// Selection and clamping
//
// Raw dominant colours are frequently unusable: album art skews toward near
// black and near white, and a theme built straight from a centroid is often
// invisible. We pick by vibrancy, then force the result into a lightness and
// saturation band that stays readable.
// ---------------------------------------------------------------------------

function vibrancy(c: { color: RGB; count: number }, total: number): number {
  const [, s, l] = rgbToHsl(c.color);
  const share = c.count / total;
  // Penalize colours near the lightness extremes — they carry no hue signal.
  const usable = 1 - Math.abs(l - 0.5) * 2;
  return share * 0.4 + s * 0.4 + usable * 0.2;
}

function clampAccent(color: RGB, targetL: number): string {
  const [h, s] = rgbToHsl(color);
  return hslToHex(h, Math.max(s, 0.42), targetL);
}

function buildPalette(clusters: { color: RGB; count: number }[]): Palette {
  const total = clusters.reduce((sum, c) => sum + c.count, 0);
  if (!total) return FALLBACK;

  const ranked = [...clusters].sort(
    (a, b) => vibrancy(b, total) - vibrancy(a, total)
  );

  const primary = ranked[0].color;
  const secondary = (ranked[1] ?? ranked[0]).color;

  return {
    accent: clampAccent(primary, 0.55),
    accentAlt: clampAccent(secondary, 0.6),
    accentSoft: clampAccent(primary, 0.94),
    accentDeep: clampAccent(primary, 0.24),
    raw: clusters.map((c) => rgbToHex(c.color)),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const getPalette = unstable_cache(
  async (urls: string[]): Promise<Palette> => {
    if (!urls.length) return FALLBACK;

    try {
      const pixels = await collectPixels(urls.slice(0, 25));
      if (pixels.length < 16) return FALLBACK;
      return buildPalette(kmeans(pixels, 6));
    } catch (err) {
      console.error('[palette] extraction failed:', err);
      return FALLBACK;
    }
  },
  ['palette'],
  { revalidate: 86_400, tags: ['spotify'] }
);

export { FALLBACK as fallbackPalette };