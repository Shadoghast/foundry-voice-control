import { describe, it, expect } from "vitest";
import { dnd5eServer } from "../scripts/server/systems/dnd5e.mjs";

describe("D&D 5e server validators", () => {
  describe("validateActorSpec", () => {
    it("accepts a minimal character", () => {
      const r = dnd5eServer.validateActorSpec({ name: "Hera", type: "character" });
      expect(r.ok).toBe(true);
    });

    it("rejects unknown actor type", () => {
      const r = dnd5eServer.validateActorSpec({ name: "x", type: "monster" });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("type");
    });

    it("accepts the four documented actor types", () => {
      for (const type of ["character", "npc", "vehicle", "group"]) {
        const r = dnd5eServer.validateActorSpec({ type });
        expect(r.ok).toBe(true);
      }
    });

    it("rejects unknown ability keys", () => {
      const r = dnd5eServer.validateActorSpec({
        type: "character",
        system: { abilities: { foo: { value: 12 } } },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.abilities.foo");
    });

    it("rejects ability scores outside 1-30", () => {
      const r = dnd5eServer.validateActorSpec({
        type: "character",
        system: { abilities: { str: { value: 40 } } },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.abilities.str.value");
    });

    it("rejects non-canonical proficient values", () => {
      const r = dnd5eServer.validateActorSpec({
        type: "character",
        system: { abilities: { str: { value: 10, proficient: 2 } } },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.abilities.str.proficient");
    });

    it("accepts canonical skill keys with valid proficiency multipliers", () => {
      for (const v of [0, 0.5, 1, 2]) {
        const r = dnd5eServer.validateActorSpec({
          type: "character",
          system: { skills: { per: { value: v } } },
        });
        expect(r.ok).toBe(true);
      }
    });

    it("rejects unknown skill keys", () => {
      const r = dnd5eServer.validateActorSpec({
        type: "character",
        system: { skills: { perception: { value: 1 } } },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.skills.perception");
    });

    it("rejects skill ability not in the six-ability set", () => {
      const r = dnd5eServer.validateActorSpec({
        type: "character",
        system: { skills: { per: { value: 1, ability: "luck" } } },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.skills.per.ability");
    });

    it("rejects unknown size", () => {
      const r = dnd5eServer.validateActorSpec({
        type: "character",
        system: { traits: { size: "small" } }, // 'sm' is the canonical key
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.traits.size");
    });

    it("accepts canonical sizes", () => {
      for (const size of ["tiny", "sm", "med", "lg", "huge", "grg"]) {
        const r = dnd5eServer.validateActorSpec({
          type: "character",
          system: { traits: { size } },
        });
        expect(r.ok).toBe(true);
      }
    });
  });

  describe("validateItemSpec", () => {
    it("rejects unknown item type", () => {
      const r = dnd5eServer.validateItemSpec({ type: "magic-item" });
      expect(r.ok).toBe(false);
    });

    it("rejects spell level outside 0-9", () => {
      const r = dnd5eServer.validateItemSpec({ type: "spell", system: { level: 10 } });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.level");
    });

    it("accepts cantrip (level 0) and 9th-level spell", () => {
      for (const level of [0, 9]) {
        const r = dnd5eServer.validateItemSpec({ type: "spell", system: { level } });
        expect(r.ok).toBe(true);
      }
    });

    it("rejects unknown preparation mode", () => {
      const r = dnd5eServer.validateItemSpec({
        type: "spell",
        system: { preparation: { mode: "studied" } },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.preparation.mode");
    });

    it("rejects unknown weaponType", () => {
      const r = dnd5eServer.validateItemSpec({
        type: "weapon",
        system: { weaponType: "exotic" },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.weaponType");
    });

    it("rejects unknown actionType", () => {
      const r = dnd5eServer.validateItemSpec({
        type: "weapon",
        system: { actionType: "spinkick" },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.actionType");
    });

    it("rejects damage parts that aren't an array of tuples", () => {
      const r = dnd5eServer.validateItemSpec({
        type: "weapon",
        system: { damage: { parts: "1d8 slashing" } },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.damage.parts");
    });

    it("rejects damage parts with wrong tuple shape", () => {
      const r = dnd5eServer.validateItemSpec({
        type: "weapon",
        system: { damage: { parts: [["1d8"]] } },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.damage.parts[0]");
    });

    it("rejects unknown damage type within tuple", () => {
      const r = dnd5eServer.validateItemSpec({
        type: "weapon",
        system: { damage: { parts: [["1d8", "magic"]] } },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.damage.parts[0][1]");
    });

    it("accepts valid damage parts", () => {
      const r = dnd5eServer.validateItemSpec({
        type: "weapon",
        system: { damage: { parts: [["1d8 + @mod", "slashing"], ["1d6", "fire"]] } },
      });
      expect(r.ok).toBe(true);
    });

    it("rejects unknown save ability", () => {
      const r = dnd5eServer.validateItemSpec({
        type: "spell",
        system: { save: { ability: "luck", dc: 15 } },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe("system.save.ability");
    });
  });

  describe("validateUpdatePath — computed-path rejection (the dnd5e gotcha)", () => {
    const computedPaths = [
      "system.attributes.prof",
      "system.attributes.spelldc",
      "system.attributes.ac.value",
      "system.details.level",
      "system.abilities.str.mod",
      "system.abilities.dex.save",
      "system.abilities.cha.dc",
      "system.skills.per.total",
      "system.skills.ath.passive",
    ];

    for (const path of computedPaths) {
      it(`rejects '${path}' with a hint`, () => {
        const r = dnd5eServer.validateUpdatePath(path, "actor");
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/computed/i);
        // The hint should point at the underlying value to write instead.
        expect(r.error.length).toBeGreaterThan(20);
      });
    }

    it("allows universal paths", () => {
      expect(dnd5eServer.validateUpdatePath("name").ok).toBe(true);
      expect(dnd5eServer.validateUpdatePath("img").ok).toBe(true);
      expect(dnd5eServer.validateUpdatePath("prototypeToken.texture.src").ok).toBe(true);
    });

    it("allows writable underlying paths", () => {
      expect(dnd5eServer.validateUpdatePath("system.attributes.hp.value").ok).toBe(true);
      expect(dnd5eServer.validateUpdatePath("system.abilities.str.value").ok).toBe(true);
      expect(dnd5eServer.validateUpdatePath("system.skills.per.value").ok).toBe(true);
      expect(dnd5eServer.validateUpdatePath("system.attributes.ac.flat").ok).toBe(true);
    });

    it("rejects non-string paths", () => {
      expect(dnd5eServer.validateUpdatePath(42).ok).toBe(false);
      expect(dnd5eServer.validateUpdatePath(null).ok).toBe(false);
    });
  });

  describe("composeActorSummary", () => {
    it("PC variant uses Level + class name + HP + AC", () => {
      const actor = {
        name: "Hera",
        type: "character",
        system: {
          details: { level: 5 },
          attributes: {
            hp: { value: 36, max: 50 },
            ac: { value: 17 },
          },
        },
        items: { contents: [{ name: "Fighter", type: "class", system: { levels: 5 } }] },
      };
      const s = dnd5eServer.composeActorSummary(actor);
      expect(s).toContain("Hera");
      expect(s).toContain("Level 5");
      expect(s).toContain("Fighter");
      expect(s).toContain("HP 36/50");
      expect(s).toContain("AC 17");
    });

    it("PC variant picks the highest-level class as primary", () => {
      const actor = {
        name: "Multi",
        type: "character",
        system: { details: { level: 7 } },
        items: {
          contents: [
            { name: "Wizard", type: "class", system: { levels: 2 } },
            { name: "Sorcerer", type: "class", system: { levels: 5 } },
          ],
        },
      };
      const s = dnd5eServer.composeActorSummary(actor);
      expect(s).toContain("Sorcerer");
      expect(s).not.toContain("Wizard");
    });

    it("NPC variant uses CR + creature type", () => {
      const npc = {
        name: "Goblin Boss",
        type: "npc",
        system: {
          details: { cr: 1, type: { value: "humanoid" } },
          attributes: {
            hp: { value: 21, max: 21 },
            ac: { flat: 17 },
          },
        },
      };
      const s = dnd5eServer.composeActorSummary(npc);
      expect(s).toContain("Goblin Boss");
      expect(s).toContain("CR 1");
      expect(s).toContain("humanoid");
      expect(s).toContain("HP 21/21");
      expect(s).toContain("AC 17");
    });

    it("handles missing optional fields gracefully", () => {
      const actor = { name: "Sparse", type: "character", system: {}, items: { contents: [] } };
      const s = dnd5eServer.composeActorSummary(actor);
      expect(s).toContain("Sparse");
      expect(s).toMatch(/\.$/); // ends with period
    });
  });

  describe("metadata exports", () => {
    it("exposes the six abilities", () => {
      expect(dnd5eServer.abilities).toEqual(["str", "dex", "con", "int", "wis", "cha"]);
    });

    it("exposes 18 SRD skill keys", () => {
      expect(dnd5eServer.skills).toHaveLength(18);
      expect(dnd5eServer.skills).toContain("per");
      expect(dnd5eServer.skills).toContain("acr");
      expect(dnd5eServer.skills).toContain("sur");
    });
  });
});
