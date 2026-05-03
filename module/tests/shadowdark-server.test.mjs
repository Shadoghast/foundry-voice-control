import { describe, it, expect } from "vitest";
import { shadowdarkServer } from "../scripts/server/systems/shadowdark.mjs";

describe("Shadowdark server validators", () => {
  describe("validateActorSpec", () => {
    it("accepts a minimal player", () => {
      const r = shadowdarkServer.validateActorSpec({ name: "Hera", type: "player" });
      expect(r.ok).toBe(true);
    });

    it("rejects unknown actor type", () => {
      const r = shadowdarkServer.validateActorSpec({ name: "x", type: "wizard" });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("type");
    });

    it("rejects numeric movement (categorical only)", () => {
      const r = shadowdarkServer.validateActorSpec({
        type: "player",
        system: { attributes: { move: 30 } },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.attributes.move");
      expect(r.errors[0].received).toBe("number");
    });

    it("rejects unknown movement string", () => {
      const r = shadowdarkServer.validateActorSpec({
        type: "player",
        system: { attributes: { move: "fast" } },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.attributes.move");
    });

    it("accepts the three valid movement values", () => {
      for (const move of ["close", "near", "far"]) {
        const r = shadowdarkServer.validateActorSpec({
          type: "player",
          system: { attributes: { move } },
        });
        expect(r.ok).toBe(true);
      }
    });

    it("rejects ability scores outside 3-18", () => {
      const r = shadowdarkServer.validateActorSpec({
        type: "player",
        system: { abilities: { str: { value: 25 } } },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.abilities.str.value");
    });

    it("rejects unknown ability keys", () => {
      const r = shadowdarkServer.validateActorSpec({
        type: "player",
        system: { abilities: { wisdom: { value: 12 } } },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.abilities.wisdom");
    });

    it("rejects level outside 1-10", () => {
      const r = shadowdarkServer.validateActorSpec({
        type: "player",
        system: { level: { value: 11 } },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.level");
    });

    it("rejects unknown alignment values", () => {
      const r = shadowdarkServer.validateActorSpec({
        type: "player",
        system: { alignment: "good" },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.alignment");
    });

    it("accepts lawful / neutral / chaotic", () => {
      for (const alignment of ["lawful", "neutral", "chaotic"]) {
        const r = shadowdarkServer.validateActorSpec({
          type: "player",
          system: { alignment },
        });
        expect(r.ok).toBe(true);
      }
    });
  });

  describe("validateItemSpec", () => {
    it("rejects unknown item type", () => {
      const r = shadowdarkServer.validateItemSpec({ type: "scimitar-of-haste" });
      expect(r.ok).toBe(false);
    });

    it("rejects spell tier outside 1-5", () => {
      const bad = shadowdarkServer.validateItemSpec({
        type: "spell",
        system: { tier: 6 },
      });
      expect(bad.ok).toBe(false);
      const ok = shadowdarkServer.validateItemSpec({
        type: "spell",
        system: { tier: 3 },
      });
      expect(ok.ok).toBe(true);
    });

    it("rejects non-categorical weapon range", () => {
      const r = shadowdarkServer.validateItemSpec({
        type: "weapon",
        system: { range: 30 },
      });
      expect(r.ok).toBe(false);
    });

    it("accepts close / near / far weapon range", () => {
      for (const range of ["close", "near", "far"]) {
        const r = shadowdarkServer.validateItemSpec({
          type: "weapon",
          system: { range },
        });
        expect(r.ok).toBe(true);
      }
    });

    it("rejects unknown weaponType", () => {
      const r = shadowdarkServer.validateItemSpec({
        type: "weapon",
        system: { weaponType: "thrown" },
      });
      expect(r.ok).toBe(false);
    });
  });

  describe("validateUpdatePath", () => {
    it("allows universal paths", () => {
      expect(shadowdarkServer.validateUpdatePath("name").ok).toBe(true);
      expect(shadowdarkServer.validateUpdatePath("img").ok).toBe(true);
      expect(shadowdarkServer.validateUpdatePath("prototypeToken.texture.src").ok).toBe(true);
    });

    it("permissively allows system.* paths", () => {
      expect(shadowdarkServer.validateUpdatePath("system.attributes.hp.value").ok).toBe(true);
      expect(shadowdarkServer.validateUpdatePath("system.abilities.str.value").ok).toBe(true);
    });

    it("rejects non-string paths", () => {
      expect(shadowdarkServer.validateUpdatePath(42).ok).toBe(false);
      expect(shadowdarkServer.validateUpdatePath(null).ok).toBe(false);
    });
  });

  describe("composeActorSummary", () => {
    it("Player variant includes Level, class, HP, AC", () => {
      const actor = {
        name: "Hera",
        type: "player",
        system: {
          level: { value: 4 },
          class: "Fighter",
          attributes: {
            hp: { value: 18, max: 24 },
            ac: { value: 16 },
          },
        },
      };
      const s = shadowdarkServer.composeActorSummary(actor);
      expect(s).toContain("Hera");
      expect(s).toContain("Level 4");
      expect(s).toContain("Fighter");
      expect(s).toContain("HP 18/24");
      expect(s).toContain("AC 16");
    });

    it("NPC variant includes type, HP, AC, move", () => {
      const npc = {
        name: "Bandit",
        type: "npc",
        system: {
          attributes: {
            hp: { value: 5, max: 7 },
            ac: { value: 12 },
            move: "near",
          },
        },
      };
      const s = shadowdarkServer.composeActorSummary(npc);
      expect(s).toContain("Bandit");
      expect(s).toContain("npc");
      expect(s).toContain("HP 5/7");
      expect(s).toContain("AC 12");
      expect(s).toContain("move near");
    });

    it("handles missing fields gracefully", () => {
      const actor = { name: "Sketch", type: "player", system: {} };
      const s = shadowdarkServer.composeActorSummary(actor);
      expect(s).toContain("Sketch");
      expect(s).toMatch(/\.$/); // ends with period
    });
  });

  describe("metadata exports", () => {
    it("exposes the six standard abilities", () => {
      expect(shadowdarkServer.abilities).toEqual(["str", "dex", "con", "int", "wis", "cha"]);
    });

    it("exposes the three movement bands", () => {
      expect(shadowdarkServer.movements).toEqual(["close", "near", "far"]);
    });
  });
});
