/**
 * Foundry Voice Control — Warhammer: The Old World (Cubicle 7) — server validators.
 *
 * Implements the server-side half of the system handler. Validators here
 * are PERMISSIVE because the WH:TOW Foundry implementation is young and
 * paths shift between releases — see references/systems/whtow.md for the
 * VERIFY items. We accept any well-formed payload and let the system's
 * own DataModel reject obviously bad updates at write time.
 *
 * VERIFY: the actual `game.system.id` for the WH:TOW Foundry system.
 * Update SYSTEM_ID at install if the registered id differs from
 * "whtow".
 */

const SYSTEM_ID = "whtow"; // VERIFY at install — also try "wh-old-world" / "the-old-world"

// Canonical Characteristics (per references/systems/whtow.md).
const CHARACTERISTICS = ["ws", "bs", "s", "t", "i", "ag", "re", "fel"];

// Skill keys; each maps to a single Characteristic.
const SKILL_TO_CHAR = Object.freeze({
  melee: "ws",
  defence: "ws",
  shooting: "bs",
  throwing: "bs",
  brawn: "s",
  toil: "s",
  survival: "t",
  endurance: "t",
  awareness: "i",
  dexterity: "i",
  athletics: "ag",
  stealth: "ag",
  willpower: "re",
  recall: "re",
  leadership: "fel",
  charm: "fel",
});

const CONDITIONS = new Set([
  "staggered",
  "broken",
  "burdened",
  "drained",
  "distracted",
  "ablaze",
  "prone",
  "blinded",
]);

const VALID_ACTOR_TYPES = new Set(["character", "npc", "creature"]);
const VALID_ITEM_TYPES = new Set([
  "weapon",
  "armour",
  "gear",
  "talent",
  "spell",
  "prayer",
  "blessing",
  "lore",
  "career",
  "origin",
  "contact",
  "condition",
]);

export const whtowServer = Object.freeze({
  id: SYSTEM_ID,

  /** Skill-key map exposed for client-side use. */
  skillToChar: SKILL_TO_CHAR,
  characteristics: CHARACTERISTICS,
  conditions: [...CONDITIONS],

  validateActorSpec(spec) {
    const errors = [];
    if (spec.type && !VALID_ACTOR_TYPES.has(spec.type)) {
      errors.push({ path: "type", expected: [...VALID_ACTOR_TYPES] });
    }
    // VERIFY: actual schema. We only verify *structure* of expected keys
    // when present; absence is fine (DataModel fills defaults).
    if (spec.system) {
      const sys = spec.system;
      if (sys.characteristics && typeof sys.characteristics !== "object") {
        errors.push({ path: "system.characteristics", expected: "object" });
      }
      if (sys.skills && typeof sys.skills !== "object") {
        errors.push({ path: "system.skills", expected: "object" });
      }
      if (sys.conditions && !Array.isArray(sys.conditions)) {
        errors.push({ path: "system.conditions", expected: "array of condition keys" });
      }
      if (Array.isArray(sys.conditions)) {
        for (const c of sys.conditions) {
          if (!CONDITIONS.has(c)) {
            errors.push({
              path: "system.conditions",
              error: `Unknown condition '${c}'`,
              valid: [...CONDITIONS],
            });
          }
        }
      }
      // Movement is categorical, not feet — reject numbers.
      const move = sys.attributes?.move;
      if (typeof move === "number") {
        errors.push({
          path: "system.attributes.move",
          expected: "close | near | far",
          received: "number",
        });
      }
    }
    return { ok: errors.length === 0, errors };
  },

  validateItemSpec(spec) {
    const errors = [];
    if (spec.type && !VALID_ITEM_TYPES.has(spec.type)) {
      errors.push({ path: "type", expected: [...VALID_ITEM_TYPES] });
    }
    if (spec.type === "spell" && spec.system) {
      const tier = spec.system.tier;
      if (tier !== undefined && (!Number.isInteger(tier) || tier < 1 || tier > 5)) {
        errors.push({ path: "system.tier", expected: "integer 1-5" });
      }
    }
    if (spec.type === "weapon" && spec.system?.skill) {
      if (!SKILL_TO_CHAR[spec.system.skill]) {
        errors.push({
          path: "system.skill",
          expected: "skill key",
          valid: Object.keys(SKILL_TO_CHAR),
        });
      }
    }
    return { ok: errors.length === 0, errors };
  },

  /** Validate a single update_actor / update_item dot-path. */
  validateUpdatePath(path, kind) {
    if (typeof path !== "string") return { ok: false, error: "path must be string" };

    // Universal paths always allowed.
    if (path === "name" || path === "img" || path.startsWith("prototypeToken.")) {
      return { ok: true };
    }
    if (!path.startsWith("system.")) {
      return { ok: true }; // permissive for unknown top-level — Foundry will no-op silently
    }

    // Movement check — categorical only.
    if (path === "system.attributes.move") {
      // Validation can't see the value here; that check happens in
      // validateActorSpec. Allow the path.
      return { ok: true };
    }

    // Conditions array — accept; validation of contents happens at write time
    // via the schema-level reject above.
    return { ok: true };
  },

  composeActorSummary(actor) {
    const sys = actor?.system ?? {};
    const wounds = sys.wounds;
    const resilience = sys.resilience?.value;
    const fate = sys.fate;
    const isPc = actor.type === "character";

    const parts = [`${actor.name}`];
    if (isPc) {
      const origin = typeof sys.origin === "string" ? sys.origin : sys.origin?.name;
      const career = typeof sys.career === "string" ? sys.career : sys.career?.name;
      const tag = [origin, career].filter(Boolean).join(" ");
      if (tag) parts[0] = `${actor.name} — ${tag}`;
    } else {
      parts[0] = `${actor.name} — ${actor.type}`;
    }

    if (wounds && Number.isFinite(wounds.value) && Number.isFinite(wounds.max)) {
      parts.push(`Wounds ${wounds.value}/${wounds.max}`);
    }
    if (Number.isFinite(resilience)) {
      parts.push(`Resilience ${resilience}`);
    }
    if (isPc && fate && Number.isFinite(fate.value) && Number.isFinite(fate.max)) {
      parts.push(`Fate ${fate.value}/${fate.max}`);
    }

    return parts.join(", ") + ".";
  },
});
