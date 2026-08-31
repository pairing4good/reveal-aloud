/**
 * PURE. Breaks a note into utterance-sized pieces.
 *
 * This is not cosmetic. Chrome silently truncates a single utterance at roughly fifteen
 * seconds, so a long note spoken as one blob simply stops mid-sentence. Splitting on
 * sentence boundaries fixes that and, as a bonus, gives the narrator natural pauses and
 * gives navigation a fine-grained place to interrupt.
 */

const DEFAULT_MAX_CHARS = 180;

/** Words whose trailing period does not end a sentence. */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc',
  'e.g', 'i.e', 'fig', 'no', 'inc', 'ltd', 'approx', 'al', 'ca'
]);

/**
 * @param {string} text normalized note text (newlines mark deliberate pauses)
 * @param {{maxChars?: number}} [options]
 * @returns {string[]} non-empty chunks, in order. No characters are lost: concatenating the
 *   chunks reproduces the input apart from whitespace at the seams.
 */
export function chunk(text, options = {}) {
  const maxChars = Math.max(1, options.maxChars ?? DEFAULT_MAX_CHARS);
  if (typeof text !== 'string' || text.trim() === '') return [];

  const chunks = [];
  for (const line of text.split('\n')) {
    for (const sentence of splitSentences(line)) {
      for (const piece of wrap(sentence, maxChars)) chunks.push(piece);
    }
  }
  return chunks;
}

function splitSentences(line) {
  const sentences = [];
  // A terminator only ends a sentence when whitespace or the end of the line follows it,
  // which keeps `3.14` and `example.com` in one piece.
  const terminator = /[.!?…]+(?=\s|$)/g;
  let start = 0;
  let match;

  while ((match = terminator.exec(line)) !== null) {
    const end = match.index + match[0].length;
    const candidate = line.slice(start, end);
    if (endsWithAbbreviation(candidate)) continue;
    sentences.push(candidate);
    start = end;
  }
  if (start < line.length) sentences.push(line.slice(start));

  return sentences.map((s) => s.trim()).filter((s) => s !== '');
}

function endsWithAbbreviation(candidate) {
  const trimmed = candidate.trimEnd();
  if (!trimmed.endsWith('.')) return false;
  const lastWord = trimmed.slice(0, -1).split(/\s/).pop().toLowerCase();
  // A lone initial ("J. Random Hacker") is the other common false positive.
  return ABBREVIATIONS.has(lastWord) || /^\p{L}$/u.test(lastWord);
}

function wrap(sentence, maxChars) {
  if (sentence.length <= maxChars) return [sentence];

  const pieces = [];
  let rest = sentence;

  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1);
    let cut = window.lastIndexOf(', ');
    if (cut > 0) {
      cut += 1; // keep the comma with the piece it belongs to
    } else {
      cut = window.lastIndexOf(' ');
    }
    // A single unbreakable token longer than the limit: cut it rather than emit an
    // utterance the engine will truncate anyway.
    if (cut <= 0) cut = maxChars;

    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest !== '') pieces.push(rest);
  return pieces.filter((piece) => piece !== '');
}
