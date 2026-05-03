/**
 * Foundry Voice Control — name / id resolver.
 *
 * Universal "find one of these by id-or-name" helper used by every tool
 * that takes a `*_or_name` parameter. Implements the resolution order
 * documented in docs/api-contract.md "Naming and resolution":
 *   1. exact id
 *   2. exact name (case-insensitive, trimmed)
 *   3. fuzzy match
 *
 * Throws AmbiguousError if multiple matches above threshold are within an
 * `ambiguousMargin` of each other; throws NotFoundError with up to three
 * suggestions on a complete miss; throws ValidationError on empty / single-
 * character input per safety doc.
 */

import { AmbiguousError, NotFoundError, ValidationError } from "./errors.mjs";

const DEFAULT_THRESHOLD = 0.7;
const DEFAULT_AMBIGUOUS_MARGIN = 0.05;

/**
 * @param {object} args
 * @param {Iterable<{id: string, name: string}>} args.items - candidates
 * @param {string} args.query
 * @param {string} args.kind - error label ("scene", "actor", ...)
 * @param {number} [args.threshold]
 * @param {number} [args.ambiguousMargin]
 * @returns {{ match: any, score: number, matchedBy: "id" | "name" | "fuzzy" }}
 */
export function resolveByIdOrName({
  items,
  query,
  kind,
  threshold = DEFAULT_THRESHOLD,
  ambiguousMargin = DEFAULT_AMBIGUOUS_MARGIN,
}) {
  validateQuery(query, kind);

  const list = [...items];
  const queryLower = query.trim().toLowerCase();

  // 1. Exact id.
  for (const item of list) {
    if (item.id === query) {
      return { match: item, score: 1.0, matchedBy: "id" };
    }
  }

  // 2. Exact name.
  for (const item of list) {
    if (typeof item.name === "string" && item.name.trim().toLowerCase() === queryLower) {
      return { match: item, score: 1.0, matchedBy: "name" };
    }
  }

  // 3. Fuzzy.
  const scored = list
    .filter((item) => typeof item.name === "string")
    .map((item) => ({ item, score: fuzzyScore(queryLower, item.name.trim().toLowerCase()) }))
    .sort((a, b) => b.score - a.score);

  const above = scored.filter((s) => s.score >= threshold);
  if (above.length === 0) {
    const suggestions = scored
      .slice(0, 3)
      .map(({ item, score }) => ({ id: item.id, name: item.name, score: round(score) }));
    throw new NotFoundError(kind, query, suggestions);
  }

  // Ambiguity: top two close in score.
  if (above.length >= 2 && above[0].score - above[1].score < ambiguousMargin) {
    const candidates = above
      .slice(0, 5)
      .map(({ item, score }) => ({ id: item.id, name: item.name, score: round(score) }));
    throw new AmbiguousError(kind, query, candidates);
  }

  return { match: above[0].item, score: above[0].score, matchedBy: "fuzzy" };
}

/**
 * Score-only variant — returns sorted candidates above threshold without
 * throwing. Useful for `find_actor` and `list_*` tools that present
 * ranked results.
 */
export function scoreItems(items, query, threshold = 0) {
  if (!query || typeof query !== "string") return [];
  const queryLower = query.trim().toLowerCase();
  const out = [];
  for (const item of items) {
    if (typeof item.name !== "string") continue;
    const score = fuzzyScore(queryLower, item.name.trim().toLowerCase());
    if (score >= threshold) out.push({ item, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function validateQuery(query, kind) {
  if (typeof query !== "string") {
    throw new ValidationError(`${kind} query must be a string.`);
  }
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    throw new ValidationError(`${kind} query must be at least 2 characters.`);
  }
}

function fuzzyScore(a, b) {
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  return 1 - levenshtein(a, b) / maxLen;
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array(a.length + 1);
  let curr = new Array(a.length + 1);
  for (let j = 0; j <= a.length; j++) prev[j] = j;

  for (let i = 1; i <= b.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= a.length; j++) {
      const cost = a.charAt(j - 1) === b.charAt(i - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,            // deletion
        curr[j - 1] + 1,        // insertion
        prev[j - 1] + cost,     // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length];
}

function round(n, places = 2) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export const _internal = { fuzzyScore, levenshtein };
