import { describe, it, expect } from "vitest";
import { resolveByIdOrName, scoreItems, _internal } from "../scripts/shared/resolver.mjs";

const ITEMS = [
  { id: "scn_1", name: "Bridge of Khazad-Dum" },
  { id: "scn_2", name: "Bridge to Nowhere" },
  { id: "scn_3", name: "Bandit Camp" },
];

describe("resolveByIdOrName", () => {
  it("matches exact id with score 1.0", () => {
    const r = resolveByIdOrName({ items: ITEMS, query: "scn_1", kind: "scene" });
    expect(r.match.id).toBe("scn_1");
    expect(r.matchedBy).toBe("id");
    expect(r.score).toBe(1.0);
  });

  it("matches exact name (case-insensitive, trimmed)", () => {
    const r = resolveByIdOrName({
      items: ITEMS,
      query: "  bridge of khazad-dum  ",
      kind: "scene",
    });
    expect(r.match.id).toBe("scn_1");
    expect(r.matchedBy).toBe("name");
  });

  it("falls back to fuzzy and prefers the highest score", () => {
    const r = resolveByIdOrName({ items: ITEMS, query: "Bandit Camps", kind: "scene" });
    expect(r.match.id).toBe("scn_3");
    expect(r.matchedBy).toBe("fuzzy");
    expect(r.score).toBeGreaterThanOrEqual(0.7);
  });

  it("throws AmbiguousError when top two are within margin", () => {
    // Two items that differ by one character — both score ~0.91 against
    // the query, well above threshold and within the 0.05 margin.
    const ambiguous = [
      { id: "1", name: "Bandit Boss" },
      { id: "2", name: "Bandit Bosc" },
    ];
    let thrown;
    try {
      resolveByIdOrName({ items: ambiguous, query: "Bandit Bos", kind: "actor" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown?.code).toBe("ambiguous");
    expect(thrown?.details?.candidates?.length).toBeGreaterThanOrEqual(2);
  });

  it("throws NotFoundError with up to 3 suggestions when nothing scores high enough", () => {
    let thrown;
    try {
      resolveByIdOrName({ items: ITEMS, query: "Eldritch Spire", kind: "scene" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown.code).toBe("not_found");
    expect(thrown.details.suggestions.length).toBeLessThanOrEqual(3);
  });

  it("rejects empty / whitespace / single-character queries (safety doc)", () => {
    for (const q of ["", "   ", "a", "X"]) {
      expect(() => resolveByIdOrName({ items: ITEMS, query: q, kind: "actor" })).toThrow();
    }
  });

  it("rejects non-string queries", () => {
    expect(() => resolveByIdOrName({ items: ITEMS, query: 42, kind: "actor" })).toThrow();
    expect(() => resolveByIdOrName({ items: ITEMS, query: null, kind: "actor" })).toThrow();
  });
});

describe("scoreItems", () => {
  it("returns sorted matches above threshold", () => {
    // Query close to two of three items; pure Levenshtein scoring favors
    // candidates whose total length is similar to the query.
    const items = [
      { id: "1", name: "Goblin Boss" },
      { id: "2", name: "Goblin Bos" },
      { id: "3", name: "Bandit Camp" },
    ];
    const r = scoreItems(items, "Goblin Boss", 0.4);
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r[0].item.name).toMatch(/Goblin/);
    // Sorted descending by score.
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
    }
  });

  it("ignores items without a name string", () => {
    const r = scoreItems([{ id: "1" }, { id: "2", name: "Boss" }], "boss", 0);
    expect(r.length).toBe(1);
  });
});

describe("internal scoring", () => {
  it("levenshtein returns expected distance", () => {
    expect(_internal.levenshtein("kitten", "sitting")).toBe(3);
    expect(_internal.levenshtein("", "abc")).toBe(3);
    expect(_internal.levenshtein("same", "same")).toBe(0);
  });
});
