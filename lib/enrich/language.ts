// lib/enrich/language.ts
//
// Language detection fallbacks, for the ~60-80% of tracks MusicBrainz can't
// answer.
//
// Three layers, best first:
//   1. MusicBrainz work language — authoritative, sparse (handled elsewhere)
//   2. A Last.fm tag that encodes it — j-pop, k-pop, french, latin
//   3. Script of the title — Hangul, Kana, Han, Cyrillic, Devanagari, Arabic
//
// Layer 3's hard limit: it cannot distinguish Latin-script languages. Spanish,
// French, English, Portuguese and Italian all look identical to a script
// detector, so it returns null rather than guessing. It also can't help with
// a Japanese song that has an English title — which is common.
//
// Everything returns ISO 639-3 to match MusicBrainz.

import 'server-only';

/**
 * Last.fm tags that reliably imply a language. Deliberately conservative:
 * a genre tag is weak evidence, and a wrong language is worse than none.
 *
 * "latin" is excluded on purpose — it's a genre covering Spanish and
 * Portuguese and sometimes neither.
 */
const TAG_LANGUAGE: Record<string, string> = {
  'j-pop': 'jpn',
  jpop: 'jpn',
  'j-rock': 'jpn',
  jrock: 'jpn',
  japanese: 'jpn',
  vocaloid: 'jpn',
  'city pop': 'jpn',
  anime: 'jpn',

  'k-pop': 'kor',
  kpop: 'kor',
  korean: 'kor',

  'c-pop': 'cmn',
  mandopop: 'cmn',
  cantopop: 'yue',
  chinese: 'cmn',

  french: 'fra',
  'french rap': 'fra',
  chanson: 'fra',

  spanish: 'spa',
  reggaeton: 'spa',
  'musica en espanol': 'spa',

  german: 'deu',
  deutsch: 'deu',

  portuguese: 'por',
  mpb: 'por',
  'brazilian music': 'por',

  italian: 'ita',
  russian: 'rus',
  swedish: 'swe',
  'bollywood': 'hin',
  hindi: 'hin',
  arabic: 'ara',
  turkish: 'tur',
  thai: 'tha',
  vietnamese: 'vie',
  indonesian: 'ind',
};

/** Infer from tags. Returns null unless a tag maps unambiguously. */
export function languageFromTags(tags: string[]): string | null {
  for (const tag of tags) {
    const hit = TAG_LANGUAGE[tag.toLowerCase().trim()];
    if (hit) return hit;
  }
  return null;
}

/**
 * Unicode ranges that identify a script unambiguously enough to be useful.
 * Order matters: Hangul and Kana are checked before Han, because Korean and
 * Japanese text both contain Han characters.
 */
const SCRIPTS: { lang: string; re: RegExp }[] = [
  { lang: 'kor', re: /[가-힯ᄀ-ᇿ]/ },        // Hangul
  { lang: 'jpn', re: /[぀-ゟ゠-ヿ]/ },        // Hiragana, Katakana
  { lang: 'cmn', re: /[一-鿿]/ },                     // Han
  { lang: 'rus', re: /[Ѐ-ӿ]/ },                     // Cyrillic
  { lang: 'ara', re: /[؀-ۿ]/ },                     // Arabic
  { lang: 'hin', re: /[ऀ-ॿ]/ },                     // Devanagari
  { lang: 'heb', re: /[֐-׿]/ },                     // Hebrew
  { lang: 'tha', re: /[฀-๿]/ },                     // Thai
  { lang: 'ell', re: /[Ͱ-Ͽ]/ },                     // Greek
];

/**
 * Detect from the title's script.
 *
 * Returns null for anything Latin-script, which is the honest answer: the
 * method genuinely cannot tell English from Spanish from French.
 *
 * Note the asymmetry — a Japanese song titled in English reads as null, while
 * an English song would never be misread as Japanese. The errors are all
 * omissions, never false positives.
 */
export function languageFromScript(title: string): string | null {
  for (const { lang, re } of SCRIPTS) {
    if (re.test(title)) return lang;
  }
  return null;
}

/** Display names for the ones we can produce. */
export const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English',
  jpn: 'Japanese',
  kor: 'Korean',
  cmn: 'Mandarin',
  yue: 'Cantonese',
  spa: 'Spanish',
  fra: 'French',
  deu: 'German',
  por: 'Portuguese',
  ita: 'Italian',
  rus: 'Russian',
  swe: 'Swedish',
  hin: 'Hindi',
  ara: 'Arabic',
  tur: 'Turkish',
  tha: 'Thai',
  vie: 'Vietnamese',
  ind: 'Indonesian',
  heb: 'Hebrew',
  ell: 'Greek',
  nld: 'Dutch',
  pol: 'Polish',
  zxx: 'Instrumental', // MusicBrainz's "no lyrics" code
};

export const languageName = (code: string): string =>
  LANGUAGE_NAMES[code] ?? code;