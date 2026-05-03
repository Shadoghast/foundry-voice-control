/**
 * Foundry Voice Control — Shadowdark RPG (Arcane Library) — server validators.
 *
 * Implements the server-side half of the system handler. Validators here
 * are PERMISSIVE because the official Shadowdark Foundry system has had
 * path drift between releases — see references/systems/shadowdark.md
 * for the VERIFY items. We accept any well-formed payload and let the
 * system's own DataModel reject obviously bad updates at write time.
 *
 * VERIFY: the actual `game.system.id`. The official Arcane Library
 * package commonly registers as "shadowdark"; community OSR
 * implementations may differ. Update SYSTEM_ID at install if needed.
 *
 * VERIFY: subtype keys for actors and items. Modern Foundry convention
 * is lowercase, which we use as default; some Shadowdark releases ship
 * mixed-case keys ("Player", "NPC Attack", ...). Compare with
 * `game.system.documentTypes.Actor` / `.Item` at module init and adjust
 * the type sets here if the registered keys differ.
 */

const SYSTEM_ID = "shadowdark"; // VERIFY at install

// Six standard ability scores (3-18 range, mod = floor((score - 10) / 2)).
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

// Movement in Shadowdark is categorical, NEVER a number. Tokens move in
// terms of these range bands — no feet, no squares.
const VALID_MOVEMENTS = new Set(["close", "near", "far"]);

// VERIFY: subtype keys against game.system.documentTypes.Actor at install.
const VALID_ACTOR_TYPES = new Set(["player", "npc", "hazard", "light"]);

// VERIFY: subtype keys against game.system.documentTypes.Item at install.
const VALID_ITEM_TYPES = new Set([
  "weapon",
  "armor",
  "gear",
  "spell",
  "talent",
  "ability",
  "effect",
  "class",
  "ancestry",
  "background",
  "npc-attack",
  "npc-special",
  "wand",
  "scroll",
  "potion",
]);

const SPELL_TIER_MIN = 1;
const SPELL_TIER_MAX = 5;
const LEVEL_MIN = 1;
const LEVEL_MAX = 10;

export const shadowdarkServer = Object.freeze({
  id: SYSTEM_ID,

  /** Exposed for client-side mirror. */
  abilities: ABILITIES,
  movements: [...VALID_MOVEMENTS],

  validateActorSpec(spec) {
    const errors = [];

    if (spec.type && !VALID_ACTOR_TYPES.has(String(spec.type).toLowerCase())) {
      errors.push({ path: "type", expected: [...VALID_ACTOR_TYPES], received: spec.type });
    }

    const sys = spec.system;
    if (!sys) return { ok: errors.length === 0, errors };

    // Movement: categorical only, no numeric values.
    const move = sys.attributes?.move;
    if (typeof move === "number") {
      errors.push({
        path: "system.attributes.move",
        expected: "close | near | far",
        received: "number",
      });
    } else if (typeof move === "string" && !VALID_MOVEMENTS.has(move)) {
      errors.push({
        path: "system.attributes.move",
        expected: [...VALID_MOVEMENTS],
        received: move,
      });
    }

    // Ability scores in the 3-18 range with valid keys.
    if (sys.abilities && typeof sys.abilities === "object") {
      for (const [ab, payload] of Object.entries(sys.abilities)) {
        if (!ABILITIES.includes(ab)) {
          errors.push({
            path: `system.abilities.${ab}`,
            error: "unknown ability key",
            valid: ABILITIES,
          });
          continue;
        }
        const score = payload?.value;
        if (score !== undefined && typeof score === "number") {
          if (!Number.isInteger(score) || score < 3 || score > 18) {
            errors.push({
              path: `system.abilities.${ab}.value`,
              expected: "integer 3-18",
              received: score,
            });
          }
        }
      }
    }

    // Level range 1-10 (Shadowdark caps at 10).
    const levelValue = sys.level?.value ?? sys.level;
    if (typeof levelValue === "number") {
      if (!Number.isInteger(levelValue) || levelValue < LEVEL_MIN || levelValue > LEVEL_MAX) {
        errors.push({
          path: "system.level",
          expected: `integer ${LEVEL_MIN}-${LEVEL_MAX}`,
          received: levelValue,
        });
      }
    }

    // Alignment: lawful / neutral / chaotic (when present).
    if (typeof sys.alignment === "string") {
      const valid = new Set(["lawful", "neutral", "chaotic"]);
      if (!valid.has(sys.alignment.toLowerCase())) {
        errors.push({
          path: "system.alignment",
          expected: [...valid],
          received: sys.alignment,
        });
      }
    }

    return { ok: errors.length === 0, errors };
  },

  validateItemSpec(spec) {
    const errors = [];

    if (spec.type && !VALID_ITEM_TYPES.has(String(spec.type).toLowerCase())) {
      errors.push({ path: "type", expected: [...VALID_ITEM_TYPES], received: spec.type });
    }

    const sys = spec.system;
    if (!sys) return { ok: errors.length === 0, errors };

    // Spell tier 1-5.
    if (spec.type === "spell") {
      const tier = sys.tier;
      if (tier !== undefined) {
        if (!Number.isInteger(tier) || tier < SPELL_TIER_MIN || tier > SPELL_TIER_MAX) {
          errors.push({
            path: "system.tier",
            expected: `integer ${SPELL_TIER_MIN}-${SPELL_TIER_MAX}`,
            received: tier,
          });
        }
      }
    }

    // Weapon range — categorical bands when present.
    if (spec.type === "weapon" && sys.range !== undefined) {
      if (typeof sys.range !== "string" || !VALID_MOVEMENTS.has(sys.range)) {
        errors.push({
          path: "system.range",
          expected: [...VALID_MOVEMENTS],
          received: sys.range,
        });
      }
    }

    // Weapon type — melee, ranged, or both.
    if (spec.type === "weapon" && sys.weaponType !== undefined) {
      const validWeaponTypes = new Set(["melee", "ranged", "both"]);
      if (!validWeaponTypes.has(String(sys.weaponType).toLowerCase())) {
        errors.push({
          path: "system.weaponType",
          expected: [...validWeaponTypes],
          received: sys.weaponType,
        });
      }
    }

    return { ok: errors.length === 0, errors };
  },

  validateUpdatePath(path /* , kind */) {
    if (typeof path !== "string") return { ok: false, error: "path must be a string" };

    // Universal paths.
    if (path === "name" || path === "img" || path.startsWith("prototypeToken.")) {
      return { ok: true };
    }
    // Permissive for system.* — value-level checks happen via validate*Spec.
    return { ok: true };
  },

  composeActorSummary(actor) {
    const sys = actor?.system ?? {};
    const isPlayer = (actor.type ?? "").toLowerCase() === "player";
    const hp = sys.attributes?.hp;
    const ac = sys.attributes?.ac?.value;
    const level = sys.level?.value ?? sys.level;

    const parts = [];

    if (isPlayer) {
      const cls = typeof sys.class === "string" ? sys.class : sys.class?.name;
      const lvlPart = Number.isFinite(level) ? `Level ${level}` : "";
      const tag = [lvlPart, cls].filter(Boolean).join(" ");
      parts.push(tag ? `${actor.name} — ${tag}` : actor.name);
    } else {
      parts.push(`${actor.name} — ${actor.type}`);
    }

    if (hp && Number.isFinite(hp.value) && Number.isFinite(hp.max)) {
      parts.push(`HP ${hp.value}/${hp.max}`);
    }
    if (Number.isFinite(ac)) {
      parts.push(`AC ${ac}`);
    }
    if (!isPlayer && typeof sys.attributes?.move === "string") {
      parts.push(`move ${sys.attributes.move}`);
    }

    return parts.join(", ") + ".";
  },
});
