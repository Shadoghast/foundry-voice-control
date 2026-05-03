import { describe, it, expect } from "vitest";
import { whtowServer } from "../scripts/server/systems/whtow.mjs";

describe("WH:TOW server validators", () => {
  describe("validateActorSpec", () => {
    it("accepts a minimal actor", () => {
      const r = whtowServer.validateActorSpec({ name: "Bob", type: "character" });
      expect(r.ok).toBe(true);
    });

    it("rejects unknown actor type", () => {
      const r = whtowServer.validateActorSpec({ name: "x", type: "wizard" });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("type");
    });

    it("rejects numeric movement (categorical only)", () => {
      const r = whtowServer.validateActorSpec({
        type: "character",
        system: { attributes: { move: 30 } },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.attributes.move");
    });

    it("rejects unknown condition keys", () => {
      const r = whtowServer.validateActorSpec({
        type: "npc",
        system: { conditions: ["staggered", "made_up_condition"] },
      });
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.path === "system.conditions")).toBe(true);
    });

    it("accepts known conditions", () => {
      const r = whtowServer.validateActorSpec({
        type: "npc",
        system: { conditions: ["staggered", "broken", "ablaze"] },
      });
      expect(r.ok).toBe(true);
    });
  });

  describe("validateItemSpec", () => {
    it("rejects unknown item type", () => {
      const r = whtowServer.validateItemSpec({ type: "potion-of-haste" });
      expect(r.ok).toBe(false);
    });

    it("rejects spell tier outside 1-5", () => {
      const bad = whtowServer.validateItemSpec({ type: "spell", system: { tier: 6 } });
      expect(bad.ok).toBe(false);
      const ok = whtowServer.validateItemSpec({ type: "spell", system: { tier: 3 } });
      expect(ok.ok).toBe(true);
    });

    it("validates weapon skill key against the canonical list", () => {
      const ok = whtowServer.validateItemSpec({
        type: "weapon",
        system: { skill: "melee" },
      });
      expect(ok.ok).toBe(true);
      const bad = whtowServer.validateItemSpec({
        type: "weapon",
        system: { skill: "magic" },
      });
      expect(bad.ok).toBe(false);
    });
  });

  describe("validateUpdatePath", () => {
    it("allows universal paths", () => {
      expect(whtowServer.validateUpdatePath("name", "actor").ok).toBe(true);
      expect(whtowServer.validateUpdatePath("img", "actor").ok).toBe(true);
      expect(whtowServer.validateUpdatePath("prototypeToken.texture.src", "actor").ok).toBe(true);
    });

    it("permissively allows system.* paths in v1", () => {
      expect(whtowServer.validateUpdatePath("system.fate.value", "actor").ok).toBe(true);
      expect(whtowServer.validateUpdatePath("system.skills.melee.rating", "actor").ok).toBe(true);
    });
  });

  describe("composeActorSummary", () => {
    it("PC variant includes Origin, Career, Wounds, Resilience, Fate", () => {
      const actor = {
        name: "Heinrich",
        type: "character",
        system: {
          origin: "Empire Human",
          career: "Soldier",
          wounds: { value: 8, max: 12 },
          resilience: { value: 5 },
          fate: { value: 1, max: 2 },
        },
      };
      const s = whtowServer.composeActorSummary(actor);
      expect(s).toContain("Heinrich");
      expect(s).toContain("Empire Human");
      expect(s).toContain("Soldier");
      expect(s).toContain("Wounds 8/12");
      expect(s).toContain("Resilience 5");
      expect(s).toContain("Fate 1/2");
    });

    it("NPC variant includes Wounds and Resilience but not Fate", () => {
      const npc = {
        name: "Beastman Raider",
        type: "npc",
        system: {
          wounds: { value: 3, max: 5 },
          resilience: { value: 4 },
        },
      };
      const s = whtowServer.composeActorSummary(npc);
      expect(s).toContain("Beastman Raider");
      expect(s).toContain("npc");
      expect(s).toContain("Wounds 3/5");
      expect(s).not.toContain("Fate");
    });
  });

  describe("metadata exports", () => {
    it("exposes the canonical 8 Characteristics", () => {
      expect(whtowServer.characteristics).toEqual(["ws", "bs", "s", "t", "i", "ag", "re", "fel"]);
    });

    it("exposes 16 skills mapping to 8 Characteristics", () => {
      const map = whtowServer.skillToChar;
      expect(Object.keys(map).length).toBe(16);
      // Each skill maps to one of the 8 Chars.
      const chars = new Set(whtowServer.characteristics);
      for (const c of Object.values(map)) expect(chars.has(c)).toBe(true);
    });

    it("exposes the canonical condition list", () => {
      expect(whtowServer.conditions).toContain("staggered");
      expect(whtowServer.conditions).toContain("broken");
      expect(whtowServer.conditions).toContain("ablaze");
    });
  });
});
