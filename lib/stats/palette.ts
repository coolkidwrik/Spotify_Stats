// lib/stats/palette.ts
import 'server-only';
import { unstable_cache } from 'next/cache';
import sharp from 'sharp';
 
export interface Palette {
  /** Dominant hue, readable on black. */
  accent: string;
  /** A visibly different secondary hue. */
  accentAlt: string;
  /** Very light tint of the accent. */
  accentSoft: string;
  /** Dark shade of the accent — borders, gradient anchors. */
  accentDeep: string;
  /** Top hue peaks, unclamped, strongest first. For debugging. */
  raw: string[];
  /** Fraction of sampled pixels that carried usable colour. For debugging. */
  chromaticShare: number;
}
 
const FALLBACK: Palette = {
  accent: '#6366f1',
  accentAlt: '#8b5cf6',
  accentSoft: '#eef0fe',
  accentDeep: '#312e81',
  raw: ['#6366f1'],
  chromaticShare: 0,
};
 
type RGB = [number, number, number];
 
/** 10 degrees per bin. Fine enough to separate orange from yellow. */
const HUE_BINS = 36;
 
/** Below this saturation a pixel is grey and carries no hue information. */
const MIN_SATURATION = 0.18;
/** Relaxed threshold, used only if the strict pass finds almost no colour. */
const MIN_SATURATION_RELAXED = 0.08;
 
const MIN_LIGHTNESS = 0.12;
const MAX_LIGHTNESS = 0.9;
 
/** Minimum separation between accent and accentAlt, in bins (60 degrees). */
const MIN_HUE_SEPARATION = 6;
 
/**
 * How heavily each cover contributes, by position in the mosaic.
 * index 0 -> 8x, 1 -> 4x, 2 -> 3x, 3 -> 2x, 4 -> 2x, 5+ -> 1x
 *
 * With 25 covers weighted equally, swapping five of them barely moves the
 * result. Front-loading means the palette tracks your current favourite.
 */
function coverWeight(index: number): number {
  return Math.max(1, Math.round(8 / (index + 1)));
}
 
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
 
// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------
 
async function samplePixels(url: string): Promise<RGB[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
 
  const buf = Buffer.from(await res.arrayBuffer());
 
  // 12x12 rather than 8x8: still a cheap box blur that kills JPEG noise, but
  // small colour accents on an otherwise dark cover survive downsampling.
  const { data } = await sharp(buf)
    .resize(12, 12, { fit: 'cover' })
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
    const slice = urls.slice(i, i + CHUNK);
    const results = await Promise.allSettled(slice.map(samplePixels));
 
    results.forEach((r, j) => {
      if (r.status !== 'fulfilled') {
        console.warn('[palette] skipped an image:', r.reason?.message);
        return;
      }
      const weight = coverWeight(i + j);
      for (let w = 0; w < weight; w++) pixels.push(...r.value);
    });
  }
 
  return pixels;
}
 
// ---------------------------------------------------------------------------
// Hue histogram
//
// The previous approach ran k-means over raw RGB. Album art is overwhelmingly
// dark backgrounds and white text, so most clusters landed on the grey axis,
// leaving one or two to represent every hue across all covers. Averaging many
// hues in RGB space converges on brown regardless of input — which is why the
// accent never moved.
//
// Binning by hue and taking the peak never averages across hues, so a red set
// of covers gives red and a teal set gives teal.
// ---------------------------------------------------------------------------
 
interface Histogram {
  weight: number[];
  sSum: number[];
  lSum: number[];
  count: number[];
  chromatic: number;
}
 
function buildHistogram(pixels: RGB[], minSaturation: number): Histogram {
  const weight = new Array(HUE_BINS).fill(0);
  const sSum = new Array(HUE_BINS).fill(0);
  const lSum = new Array(HUE_BINS).fill(0);
  const count = new Array(HUE_BINS).fill(0);
  let chromatic = 0;
 
  for (const p of pixels) {
    const [h, s, l] = rgbToHsl(p);
    if (s < minSaturation || l < MIN_LIGHTNESS || l > MAX_LIGHTNESS) continue;
 
    chromatic++;
    const bin = Math.min(HUE_BINS - 1, Math.floor(h * HUE_BINS));
 
    // Saturated, mid-lightness pixels are the most representative of a cover's
    // actual colour, so they carry more weight than washed-out ones.
    weight[bin] += s * (1 - Math.abs(l - 0.5));
    sSum[bin] += s;
    lSum[bin] += l;
    count[bin] += 1;
  }
 
  return { weight, sSum, lSum, count, chromatic };
}
 
/** Circular 3-tap smoothing so a hue straddling a bin boundary isn't split. */
function smooth(bins: number[]): number[] {
  const n = bins.length;
  return bins.map(
    (_, i) => bins[(i - 1 + n) % n] * 0.25 + bins[i] * 0.5 + bins[(i + 1) % n] * 0.25
  );
}
 
function binDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, HUE_BINS - d);
}
 
function findPeak(bins: number[], excludeNear: number[] = []): number {
  let best = -1;
  let bestValue = 0;
 
  for (let i = 0; i < bins.length; i++) {
    if (bins[i] <= bestValue) continue;
    if (excludeNear.some((e) => binDistance(i, e) < MIN_HUE_SEPARATION)) continue;
    best = i;
    bestValue = bins[i];
  }
 
  return best;
}
 
function binToHsl(h: Histogram, bin: number): [number, number, number] {
  const n = Math.max(h.count[bin], 1);
  // Bin centre, not an average of hues within the bin — averaging is exactly
  // what we're avoiding.
  return [(bin + 0.5) / HUE_BINS, h.sSum[bin] / n, h.lSum[bin] / n];
}
 
// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------
 
function clamped(
  [h, s, l]: [number, number, number],
  minL: number,
  maxL: number,
  minS = 0.42
): string {
  return hslToHex(h, Math.max(s, minS), Math.min(Math.max(l, minL), maxL));
}
 
function buildPalette(pixels: RGB[]): Palette {
  let hist = buildHistogram(pixels, MIN_SATURATION);
 
  // Genuinely monochrome cover sets exist. Relax once before giving up.
  if (hist.chromatic < pixels.length * 0.03) {
    hist = buildHistogram(pixels, MIN_SATURATION_RELAXED);
  }
  if (hist.chromatic < 24) return FALLBACK;
 
  const smoothed = smooth(hist.weight);
 
  const primaryBin = findPeak(smoothed);
  if (primaryBin < 0) return FALLBACK;
 
  // Require real separation so accentAlt is visibly a different colour rather
  // than a neighbouring shade of the same one.
  const secondaryBin = findPeak(smoothed, [primaryBin]);
 
  const primary = binToHsl(hist, primaryBin);
  const secondary =
    secondaryBin >= 0 ? binToHsl(hist, secondaryBin) : primary;
 
  // Top peaks, unclamped, for the debug log.
  const raw = [...smoothed]
    .map((w, i) => ({ w, i }))
    .filter((b) => b.w > 0)
    .sort((a, b) => b.w - a.w)
    .slice(0, 6)
    .map((b) => {
      const [h, s, l] = binToHsl(hist, b.i);
      return hslToHex(h, s, l);
    });
 
  return {
    accent: clamped(primary, 0.45, 0.68),
    accentAlt: clamped(secondary, 0.5, 0.72),
    accentSoft: clamped(primary, 0.94, 0.94),
    accentDeep: clamped(primary, 0.24, 0.24),
    raw,
    chromaticShare: hist.chromatic / pixels.length,
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
      if (pixels.length < 64) return FALLBACK;
      return buildPalette(pixels);
    } catch (err) {
      console.error('[palette] extraction failed:', err);
      return FALLBACK;
    }
  },
  ['palette'],
  { revalidate: 86_400, tags: ['spotify'] }
);
 
export { FALLBACK as fallbackPalette };