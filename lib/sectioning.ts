// Section resolution — decides what a "section" is for a loaded results file.
//
// Files arrive in three shapes and only the first two carry section truth:
//
//   1. an explicit per-item `section` (or rag-cli's `source`) label
//   2. hierarchical ids, "1.1"/"1.2"/"2.1", where the part before the first dot is the section
//   3. flat ids, "1".."56", with no section signal whatsoever
//
// Shape 3 is why this module exists: splitting a flat id on "." returns the id itself, so every
// question became its own single-question section. For those files we infer contiguous topic
// segments instead. Inferred sections carry an `inferred` flag but render identically to real ones.
//
// The output is a stable id -> section key map. Callers must resolve it once per file and never
// per filtered subset — boundaries derived from a filtered list would move as the user types, and
// assignment/reviewer state keys off section identity.

import type { QAItem, SectionInfo, SectionMap } from "./types";

/**
 * Identity of the resolution rules below. **Bump this whenever a change here can move a question
 * into a differently-keyed section** — every constant in this block counts, as does the shape of a
 * `SectionInfo.key`.
 *
 * Section keys are the primary key for assignment: `sectionAssignees`/`sectionReviewers` are stored
 * against them, and for inferred sections and split parts those keys ("inferred:2", "3~2") are
 * outputs of this file rather than anything the source document said. So a change here silently
 * orphans stored assignment — the entries stay in the room, match no section, and every section
 * reads "Unassigned" with nothing to say why. Worse in the interim: two tabs on either side of a
 * deploy sit in the same room disagreeing about what a section is, and one person's assignment lands
 * where the other cannot see it.
 *
 * Bumping does not repair any of that. It records which rules the stored keys were written under, so
 * the mismatch can be noticed and said out loud instead of looking like nobody ever assigned anyone.
 */
export const SECTION_ALGO_VERSION = 1;

/**
 * Ceiling on questions per section, applied to every section — real and inferred alike.
 *
 * Soft: a trailing part below MIN_FINAL_PART folds back into the one before it, so sections of
 * cap+1 to cap+MIN_FINAL_PART-1 questions exist by design (34 -> 10/10/14). See `partSizes`.
 *
 * Changing this re-keys every split section. Bump SECTION_ALGO_VERSION with it.
 */
export const SECTION_CAP = 10;

/** A final part below this size folds into the part before it rather than standing alone. */
const MIN_FINAL_PART = 5;

/** Window (in questions) either side of a gap when measuring lexical cohesion across it. */
const BLOCK_RADIUS = 2;

/** Depth cutoff for a boundary, in standard deviations above the mean gap depth. */
const DEPTH_CUTOFF_SD = 0.2;

/**
 * Smallest inferred segment, counted from the ends of the file as well as between boundaries; stops
 * one stray question becoming its own section.
 */
const MIN_SEGMENT_SIZE = 2;

// ---------------------------------------------------------------------------- tier 1

function explicitLabel(item: QAItem): string | undefined {
  const raw = item.section;
  if (typeof raw !== "string") return undefined;
  // rag-cli writes HTML-escaped, space-padded labels, e.g. " Functional &amp; Technical".
  const clean = raw.replace(/&amp;/g, "&").trim();
  return clean || undefined;
}

function hasExplicitSections(items: QAItem[]): boolean {
  return items.some((i) => explicitLabel(i) !== undefined);
}

/**
 * Separators an id may use between its section part and its question part, in precedence order.
 *
 * Order only decides ties on bucket count. Period leads because it is the documented format;
 * hyphen next, since "CP-01"/"MP-13" style ids are common in RFP exports. On a tie the earlier
 * delimiter wins, which keeps the fuller prefix ("CSR_Digital_Sobriety" over "CSR").
 */
const ID_DELIMITERS = [".", "-", "_", ":", "/", " "] as const;

function prefixOf(id: string, delimiter: string): string {
  return id.split(delimiter)[0];
}

/**
 * Pick the delimiter that every id carries and whose prefixes collapse the items into the fewest
 * buckets, or null when no delimiter runs through the whole file.
 *
 * The test is presence in *every* id, not a drop in bucket count. A hierarchy half the file does not
 * follow is not a hierarchy, and counting buckets instead let a single stray separator pass: a flat
 * file ("1".."56") with one duplicated id comes out of parseQAFile carrying "7.1"/"7.2", and those
 * two ids collapsing into one bucket was enough to make "." look like a delimiter and hand every
 * question its own section — the exact failure this module was written to remove. Requiring the
 * delimiter throughout keeps a genuinely flat file falling through to inference however many
 * delimiters we try, so widening the list can only rescue ids that really do carry a separator.
 *
 * No collapse at all is still signal once the delimiter is everywhere: ids "1.1", "2.1", "3.1" are
 * three single-question sections, and saying so beats inferring topics over a file that already told
 * us its structure. One bucket is signal too — rag-cli's per-section exports give every item the
 * same id, and those files are legitimately a single section.
 */
function chooseIdDelimiter(items: QAItem[]): string | null {
  let best: { delimiter: string; size: number } | null = null;
  for (const delimiter of ID_DELIMITERS) {
    if (!items.every((i) => i.id.includes(delimiter))) continue;
    const size = new Set(items.map((i) => prefixOf(i.id, delimiter))).size;
    // Strictly-less keeps the earlier, higher-precedence delimiter when counts tie.
    if (best === null || size < best.size) best = { delimiter, size };
  }
  return best?.delimiter ?? null;
}

// ------------------------------------------------------------------- tier 2: tokenising

// Standard English function words plus RFP boilerplate. IDF already flattens terms that appear in
// nearly every question, so this list is an optimisation rather than the mechanism — but dropping
// "bidder"/"manufacturer"/"recommend" early keeps the derived labels readable.
const STOPWORDS = new Set(
  `a an and are as at be been by can could do does for from has have how in is it its of on or
   that the their there these this to using was were what when where which who why will with you
   your any also more most other such via please indicate specify describe describes indicates
   specifies provide provides provided offer offers offered recommend recommends recommended
   recommendation recommendations manufacturer bidder submitter submissioner distribution
   distributions distributor official officially environment environments corporate enterprise
   solution solutions used use uses support supported supports available guidance guidelines
   documentation documented practices practice best specific particular mechanisms mechanism
   features feature options option tools tool exist exists information detail details detailed
   following order need needs required requirement`
    .split(/\s+/)
    .filter(Boolean)
);

/**
 * Crude depluralisation. Enough to collapse "policies"/"policy" and "packages"/"package" onto one
 * term so cohesion scoring sees them as the same topic word, without pulling in a real stemmer.
 */
function singularize(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  // "status"/"analysis"/"access" are not plurals; stripping the s mangles them.
  if (t.length > 4 && t.endsWith("s") && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

/** Lowercase, strip punctuation, drop short/stop tokens, depluralise. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .map(singularize)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

type Vector = Map<string, number>;

interface Corpus {
  vectors: Vector[];
  tokenLists: string[][];
  idf: Map<string, number>;
}

function buildCorpus(items: QAItem[]): Corpus {
  const tokenLists = items.map((i) => tokenize(i.question));

  const df = new Map<string, number>();
  for (const toks of tokenLists) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log(items.length / d));

  const vectors = tokenLists.map((toks) => {
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v: Vector = new Map();
    for (const [t, f] of tf) {
      const w = (1 + Math.log(f)) * (idf.get(t) ?? 0);
      if (w > 0) v.set(t, w);
    }
    return v;
  });

  return { vectors, tokenLists, idf };
}

function sumVectors(vs: Vector[]): Vector {
  const out: Vector = new Map();
  for (const v of vs) for (const [t, w] of v) out.set(t, (out.get(t) ?? 0) + w);
  return out;
}

function cosine(a: Vector, b: Vector): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) {
    const o = large.get(t);
    if (o !== undefined) dot += w * o;
  }
  if (dot === 0) return 0;
  let na = 0;
  let nb = 0;
  for (const w of a.values()) na += w * w;
  for (const w of b.values()) nb += w * w;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// --------------------------------------------------------------- tier 2: segmentation

interface GapScore {
  gap: number;
  depth: number;
}

/**
 * TextTiling-style gap scoring. Questions arrive in document order and real sections are
 * contiguous runs of it, so this only ever asks "does the topic change at this gap?" — never
 * which far-apart questions resemble each other. That keeps every segment a contiguous range,
 * and keeps the result deterministic, which matters because collaborators in one live session
 * must derive byte-identical sections from the same file.
 *
 * Blocks rather than single questions are compared: an individual question is 10-30 tokens and
 * pairwise similarity at that length is mostly noise.
 */
function scoreGaps(vectors: Vector[]): GapScore[] {
  const n = vectors.length;
  const sims: { gap: number; sim: number }[] = [];
  for (let g = 1; g < n; g++) {
    const left = sumVectors(vectors.slice(Math.max(0, g - BLOCK_RADIUS), g));
    const right = sumVectors(vectors.slice(g, Math.min(n, g + BLOCK_RADIUS)));
    sims.push({ gap: g, sim: cosine(left, right) });
  }

  // Hearst depth score: how far this valley sits below the nearest peak on each side. Scoring
  // depth rather than raw dissimilarity is what distinguishes a topic shift from a shallow dip.
  return sims.map((s, i) => {
    let l = s.sim;
    for (let j = i - 1; j >= 0; j--) {
      if (sims[j].sim < l) break;
      l = sims[j].sim;
    }
    let r = s.sim;
    for (let j = i + 1; j < sims.length; j++) {
      if (sims[j].sim < r) break;
      r = sims[j].sim;
    }
    return { gap: s.gap, depth: l - s.sim + (r - s.sim) };
  });
}

function chooseBoundaries(scored: GapScore[]): number[] {
  if (scored.length === 0) return [];

  // One gap sits between each adjacent pair, so the file is one question longer than the gap list.
  const itemCount = scored.length + 1;

  const depths = scored.map((s) => s.depth);
  const mean = depths.reduce((a, b) => a + b, 0) / depths.length;
  const sd = Math.sqrt(
    depths.reduce((a, d) => a + (d - mean) ** 2, 0) / depths.length
  );
  const threshold = mean + DEPTH_CUTOFF_SD * sd;

  const accepted: number[] = [];
  const candidates = scored
    .filter((s) => s.depth > threshold)
    // The ends count as boundaries for spacing purposes. Measuring only against accepted boundaries
    // left the first and last gaps unguarded, so a lone topical outlier at either end of the file
    // still became a one-question section — the very thing MIN_SEGMENT_SIZE exists to prevent.
    .filter((s) => s.gap >= MIN_SEGMENT_SIZE && itemCount - s.gap >= MIN_SEGMENT_SIZE)
    // Deepest first, so when two boundaries compete for the same neighbourhood the stronger
    // topic shift wins. Ties break on gap index to stay deterministic.
    .sort((a, b) => b.depth - a.depth || a.gap - b.gap);

  for (const c of candidates) {
    if (accepted.every((g) => Math.abs(g - c.gap) >= MIN_SEGMENT_SIZE)) {
      accepted.push(c.gap);
    }
  }
  return accepted.sort((a, b) => a - b);
}

// ------------------------------------------------------------------- tier 2: labelling

/** Name a segment from the terms that recur across it, weighted by how rare they are overall. */
function labelSegment(corpus: Corpus, start: number, end: number): string {
  const { tokenLists, idf } = corpus;
  const size = end - start;

  const segDf = new Map<string, number>();
  for (let i = start; i < end; i++) {
    for (const t of new Set(tokenLists[i])) segDf.set(t, (segDf.get(t) ?? 0) + 1);
  }

  const unigrams = [...segDf.entries()]
    .map(([t, d]) => {
      // A bare number ("27001", "330") is rare, so IDF loves it, but it makes a poor heading on
      // its own. Demote pure digits; keep alphanumerics like "178c", which do name a standard.
      const numeric = /^\d+$/.test(t) ? 0.35 : 1;
      return [t, (d / size) * (idf.get(t) ?? 0) * Math.sqrt(d) * numeric] as const;
    })
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);

  // A repeated bigram usually names the topic better than any single word ("active directory").
  const bigrams = new Map<string, number>();
  for (let i = start; i < end; i++) {
    const toks = tokenLists[i];
    for (let j = 0; j + 1 < toks.length; j++) {
      const key = `${toks[j]} ${toks[j + 1]}`;
      bigrams.set(key, (bigrams.get(key) ?? 0) + 1);
    }
  }
  const topBigram = [...bigrams.entries()]
    .filter(([, c]) => c >= 2)
    .map(
      ([b, c]) =>
        [b, c * b.split(" ").reduce((a, t) => a + (idf.get(t) ?? 0), 0)] as const
    )
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];

  let words: string[];
  if (topBigram) {
    const bg = topBigram[0].split(" ");
    const extra = unigrams.find((t) => !bg.includes(t));
    words = extra ? [...bg, extra] : bg;
  } else {
    words = unigrams.slice(0, 3);
  }

  if (words.length === 0) return "Untitled topic";
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

// ------------------------------------------------------------------------- soft cap

/**
 * Part sizes for a section of `n` questions.
 *
 * Greedy fill to `cap`, except that a final part below MIN_FINAL_PART folds into the part before
 * it rather than standing as a short tail. At cap 10: 35 -> [10,10,10,5], 34 -> [10,10,14],
 * 15 -> [10,5], 14 -> [14], 11 -> [11].
 *
 * A section whose total is already at or under the cap is returned untouched, which is also what
 * exempts a 1-4 question section from the minimum — there is nothing to fold it into.
 */
export function partSizes(n: number, cap = SECTION_CAP): number[] {
  if (n <= cap) return [n];

  const sizes: number[] = [];
  let rest = n;
  while (rest > cap) {
    sizes.push(cap);
    rest -= cap;
  }
  if (rest > 0) {
    if (rest < MIN_FINAL_PART) sizes[sizes.length - 1] += rest;
    else sizes.push(rest);
  }
  return sizes;
}

// ---------------------------------------------------------------------------- assembly

interface Segment {
  key: string;
  label: string;
  items: QAItem[];
}

/** A purely numeric section name numbers its parts with a decimal ("Section 3.1"). */
function isNumericName(name: string): boolean {
  return name !== "" && !Number.isNaN(Number(name));
}

/**
 * Apply the section cap, numbering the parts only when a split actually happened.
 *
 * The trailing number marks split position, so a folded final part still carries the number of the
 * position it occupies: a 34-question section becomes parts 1, 2 and 3, the third holding 14. A
 * section that never splits keeps its bare name with no number at all.
 */
function splitIntoParts(
  baseKey: string,
  baseName: string,
  items: QAItem[],
  cap: number,
  decimal: boolean
): Segment[] {
  const sizes = partSizes(items.length, cap);
  if (sizes.length === 1) return [{ key: baseKey, label: baseName, items }];

  const parts: Segment[] = [];
  let offset = 0;
  sizes.forEach((size, i) => {
    const n = i + 1;
    parts.push({
      // The part number belongs in the key too: assignment is stored per section, and two parts of
      // one original section are two separately assignable sections.
      key: `${baseKey}~${n}`,
      label: decimal ? `${baseName}.${n}` : `${baseName} ${n}`,
      items: items.slice(offset, offset + size),
    });
    offset += size;
  });
  return parts;
}

function buildMap(segments: Segment[], inferred: boolean): SectionMap {
  const byItemId: Record<string, string> = {};
  const sections: SectionInfo[] = [];

  for (const seg of segments) {
    sections.push({
      key: seg.key,
      label: seg.label,
      inferred,
      count: seg.items.length,
    });
    for (const item of seg.items) byItemId[item.id] = seg.key;
  }

  return { byItemId, sections };
}

function fromExplicit(items: QAItem[], cap: number): SectionMap {
  // First appearance wins the ordering — an explicit label set is already in document order, and
  // these labels are rarely numeric so numeric sorting would be meaningless.
  const order: string[] = [];
  const buckets = new Map<string, QAItem[]>();
  for (const item of items) {
    const label = explicitLabel(item) ?? "Unsectioned";
    if (!buckets.has(label)) {
      buckets.set(label, []);
      order.push(label);
    }
    buckets.get(label)!.push(item);
  }
  const segments = order.flatMap((label) =>
    splitIntoParts(label, label, buckets.get(label)!, cap, isNumericName(label))
  );
  return buildMap(segments, false);
}

function fromIdHierarchy(items: QAItem[], delimiter: string, cap: number): SectionMap {
  const order: string[] = [];
  const buckets = new Map<string, QAItem[]>();
  for (const item of items) {
    const prefix = prefixOf(item.id, delimiter);
    if (!buckets.has(prefix)) {
      buckets.set(prefix, []);
      order.push(prefix);
    }
    buckets.get(prefix)!.push(item);
  }

  // Numeric prefixes sort numerically ("2" before "10"); anything else keeps document order.
  // The old comparator did Number(a) - Number(b) unconditionally, which is NaN for the named
  // sections rag-cli produces and left their order down to the sort implementation.
  const allNumeric = order.every((p) => p !== "" && !Number.isNaN(Number(p)));
  const sorted = allNumeric ? [...order].sort((a, b) => Number(a) - Number(b)) : order;

  // A numeric prefix numbers its parts with a decimal ("Section 3.1"); a named one uses a plain
  // trailing number ("Section CP 1"), since "Section CP.1" reads oddly.
  const segments = sorted.flatMap((prefix) =>
    splitIntoParts(
      prefix,
      `Section ${prefix}`,
      buckets.get(prefix)!,
      cap,
      isNumericName(prefix)
    )
  );
  return buildMap(segments, false);
}

function fromInference(items: QAItem[], cap: number): SectionMap {
  const corpus = buildCorpus(items);
  const boundaries = chooseBoundaries(scoreGaps(corpus.vectors));
  const cuts = [0, ...boundaries, items.length];

  const segments: Segment[] = [];
  for (let c = 0; c + 1 < cuts.length; c++) {
    const [start, end] = [cuts[c], cuts[c + 1]];
    // Topic names are never numeric, so parts get a plain trailing number.
    segments.push(
      ...splitIntoParts(
        `inferred:${c}`,
        labelSegment(corpus, start, end),
        items.slice(start, end),
        cap,
        false
      )
    );
  }

  return buildMap(segments, true);
}

/**
 * Resolve the section map for a file. Real clues win; inference is the fallback only.
 *
 * Memoise this on the parsed file alone. Running it over a filtered subset would let boundaries
 * shift whenever the user searches or switches status filters, visibly rearranging sections and
 * appearing to move people's assignments.
 */
export function resolveSections(
  items: QAItem[],
  cap = SECTION_CAP
): SectionMap {
  if (items.length === 0) return { byItemId: {}, sections: [] };
  if (hasExplicitSections(items)) return fromExplicit(items, cap);

  const delimiter = chooseIdDelimiter(items);
  if (delimiter !== null) return fromIdHierarchy(items, delimiter, cap);

  return fromInference(items, cap);
}
