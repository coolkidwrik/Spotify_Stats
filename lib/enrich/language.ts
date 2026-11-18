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
 * Last.fm tags that imply the language of the LYRICS.
 *
 * THE RULE: a scene or genre may map to a language. A nationality may not.
 *
 * The first version of this map ignored that distinction and got it badly
 * wrong in production. Tags like 'swedish', 'german', 'italian' and
 * 'indonesian' describe where an ARTIST is from, not what language a track
 * is sung in — so ABBA's "Dancing Queen" was labelled Swedish, and C418's
 * instrumental Minecraft tracks were too, overriding a correct 'zxx' from
 * MusicBrainz. Every label those tags produced was wrong.
 *
 * The damage was amplified by the resolver reading ARTIST tags, which is
 * precisely where nationality tags live — a track is rarely tagged
 * 'swedish', but a Swedish band always is.
 *
 * What survives is the set where the tag names a scene whose output is
 * essentially always in one language. 'j-pop' is not a statement about where
 * someone was born; it is a statement about the music.
 *
 * Deliberately excluded, beyond the nationalities:
 *   latin   — a genre spanning Spanish, Portuguese, and sometimes neither
 *   anime   — names a medium, not a language. Anime soundtracks are full of
 *             instrumentals and English insert songs.
 *   j-rock / city pop are kept but are the weakest entries here; drop them
 *             first if jpn still shows errors.
 */
const TAG_LANGUAGE: Record<string, string> = {
  // Japanese scenes
  'j-pop': 'jpn',
  jpop: 'jpn',
  'j-rock': 'jpn',
  jrock: 'jpn',
  vocaloid: 'jpn',
  'city pop': 'jpn',
  enka: 'jpn',

  // Korean scenes
  'k-pop': 'kor',
  kpop: 'kor',
  'k-indie': 'kor',
  trot: 'kor',

  // Chinese scenes
  'c-pop': 'cmn',
  cpop: 'cmn',
  mandopop: 'cmn',
  cantopop: 'yue',

  // Indian film music
  bollywood: 'hin',
  filmi: 'hin',

  // Scenes defined by singing in the language
  reggaeton: 'spa',
  'musica en espanol': 'spa',
  chanson: 'fra',
  'french rap': 'fra',
  'rap francais': 'fra',
  mpb: 'por',
  'brazilian music': 'por',
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
 * Scripts that belong to exactly one language family, so seeing one is
 * decisive.
 *
 * Han is NOT in this list, and that omission is the whole point — see below.
 */
const SCRIPTS: { lang: string; re: RegExp }[] = [
  // Hangul syllables, conjoining jamo, compatibility jamo
  { lang: 'kor', re: /[가-힣ᄀ-ᇿ㄰-㆏]/ },
  // Hiragana, katakana, halfwidth katakana, iteration marks
  { lang: 'jpn', re: /[぀-ゟ゠-ヿｦ-ﾝ]/ },
  { lang: 'rus', re: /[Ѐ-ӿ]/ }, // Cyrillic — see caveat below
  { lang: 'ara', re: /[؀-ۿ]/ },
  { lang: 'hin', re: /[ऀ-ॿ]/ },
  { lang: 'heb', re: /[֐-׿]/ },
  { lang: 'tha', re: /[฀-๿]/ },
  { lang: 'ell', re: /[Ͱ-Ͽ]/ },
];

/**
 * Han characters, deliberately excluded from SCRIPTS above.
 *
 * This range was previously mapped straight to 'cmn', which was wrong and
 * produced wrong data in production: Japanese kanji, Chinese hanzi and Korean
 * hanja all live here. A Japanese title written entirely in kanji — 千本桜,
 * 恋愛裁判 — contains no kana, so it fell past the Japanese check and got
 * labelled Mandarin.
 *
 * Kept as a named export so a caller can ask "is this CJK at all?" without
 * being handed a guess about WHICH of the three.
 */
export const HAN = /[一-鿿㐀-䶿]/;

/**
 * Detect from the title's script.
 *
 * Returns null for anything Latin-script — the method genuinely cannot tell
 * English from Spanish from French — and also for Han-only titles, where it
 * cannot tell Japanese from Chinese. Those go to MusicBrainz, which can.
 *
 * The asymmetry is the design goal: every error should be an omission, never
 * a false positive. A wrong language is worse than a missing one, because a
 * missing one is visibly missing.
 *
 * One caveat that remains: Cyrillic maps to Russian, which is a guess against
 * Ukrainian, Bulgarian and Serbian. It is kept because Russian dominates by a
 * wide margin and the alternative scripts aren't separable by range either —
 * but it is a guess, and language_source = 'script' is how you know.
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