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
// segments instead, and label them "Inferred: …" so nobody mistakes a guess for an RFP heading.
//
// The output is a stable id -> section key map. Callers must resolve it once per file and never
// per filtered subset — boundaries derived from a filtered list would move as the user types, and
// assignment/reviewer state keys off section identity.

import type { QAItem, SectionInfo, SectionMap } from "./types";

/** Hard ceiling on questions per *inferred* section. Real sections are never split. */
export const INFERRED_SECTION_CAP = 15;

/** A split only happens if both resulting parts reach this size; otherwise the tail folds back. */
const MIN_PART_SIZE = 3;

/** Window (in questions) either side of a gap when measuring lexical cohesion across it. */
const BLOCK_RADIUS = 2;

/** Depth cutoff for a boundary, in standard deviations above the mean gap depth. */
const DEPTH_CUTOFF_SD = 0.2;

/** Smallest inferred segment; stops one stray question becoming its own section. */
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
 * Pick the delimiter whose prefixes collapse the items into the fewest buckets, or null when no
 * delimiter collapses them at all.
 *
 * A delimiter that does not appear in the ids is self-eliminating: split returns each id whole, so
 * the bucket count equals the item count and the collapse guard rejects it. That is what keeps a
 * genuinely flat file ("1".."56") falling through to inference no matter how many delimiters we
 * try — widening this list can only ever rescue ids that really do carry a separator.
 *
 * One bucket counts as signal, not noise: rag-cli's per-section exports give every item the same
 * id, and those files are legitimately a single section.
 */
function chooseIdDelimiter(items: QAItem[]): string | null {
  let best: { delimiter: string; size: number } | null = null;
  for (const delimiter of ID_DELIMITERS) {
    const size = new Set(items.map((i) => prefixOf(i.id, delimiter))).size;
    if (size >= items.length) continue; // no collapse — no grouping signal
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

  const depths = scored.map((s) => s.depth);
  const mean = depths.reduce((a, b) => a + b, 0) / depths.length;
  const sd = Math.sqrt(
    depths.reduce((a, d) => a + (d - mean) ** 2, 0) / depths.length
  );
  const threshold = mean + DEPTH_CUTOFF_SD * sd;

  const accepted: number[] = [];
  const candidates = scored
    .filter((s) => s.depth > threshold)
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
 * Part sizes for an inferred segment of `n` questions.
 *
 * Soft cap: fill to `cap`, but a trailing part below MIN_PART_SIZE folds back into the one before
 * it rather than standing as a 1-2 question orphan. So at cap 15: 16 -> [16], 18 -> [15, 3],
 * 31 -> [15, 16].
 */
export function partSizes(n: number, cap = INFERRED_SECTION_CAP): number[] {
  if (n <= cap) return [n];

  const sizes: number[] = [];
  let rest = n;
  while (rest > cap) {
    sizes.push(cap);
    rest -= cap;
  }
  if (rest > 0) {
    if (rest < MIN_PART_SIZE) sizes[sizes.length - 1] += rest;
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

function fromExplicit(items: QAItem[]): SectionMap {
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
  const segments = order.map((label) => ({
    key: label,
    label,
    items: buckets.get(label)!,
  }));
  return buildMap(segments, false);
}

function fromIdHierarchy(items: QAItem[], delimiter: string): SectionMap {
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

  const segments = sorted.map((prefix) => ({
    key: prefix,
    label: `Section ${prefix}`,
    items: buckets.get(prefix)!,
  }));
  return buildMap(segments, false);
}

function fromInference(items: QAItem[], cap: number): SectionMap {
  const corpus = buildCorpus(items);
  const boundaries = chooseBoundaries(scoreGaps(corpus.vectors));
  const cuts = [0, ...boundaries, items.length];

  const segments: Segment[] = [];
  for (let c = 0; c + 1 < cuts.length; c++) {
    const [start, end] = [cuts[c], cuts[c + 1]];
    const topic = labelSegment(corpus, start, end);
    const sizes = partSizes(end - start, cap);

    let offset = start;
    sizes.forEach((size, p) => {
      const suffix = sizes.length > 1 ? ` (Part ${p + 1})` : "";
      segments.push({
        key: `inferred:${segments.length}`,
        label: `Inferred: ${topic}${suffix}`,
        items: items.slice(offset, offset + size),
      });
      offset += size;
    });
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
  cap = INFERRED_SECTION_CAP
): SectionMap {
  if (items.length === 0) return { byItemId: {}, sections: [] };
  if (hasExplicitSections(items)) return fromExplicit(items);

  const delimiter = chooseIdDelimiter(items);
  if (delimiter !== null) return fromIdHierarchy(items, delimiter);

  return fromInference(items, cap);
}
