/**
 * Foundry Voice Control — D&D 5e — server validators.
 *
 * The dnd5e system is the most documented of the three we support; this
 * file is correspondingly stricter. We validate against the published
 * key sets (abilities, skills, sizes, item types, weapon types,
 * action types, damage types) and explicitly REJECT updates to
 * known-computed paths so users don't silently no-op against the
 * DataModel's derived fields.
 *
 * Doc baseline: dnd5e v3.x / v4.x conventions. The system moves fast;
 * the module logs `game.system.version` at boot — see
 * references/systems/dnd5e.md for the gotchas.
 *
 * VERIFY: occasional path drift between minor releases. The valid sets
 * below are sourced from `game.dnd5e.config.*` at runtime when
 * available; the literals here are the documented defaults.
 */

const SYSTEM_ID = "dnd5e";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_SET = new Set(ABILITIES);

// 18 skill keys per the SRD.
const SKILLS = [
  "acr", "ani", "arc", "ath", "dec", "his",
  "ins", "itm", "inv", "med", "nat", "prc",
  "prf", "per", "rel", "slt", "ste", "sur",
];
const SKILL_SET = new Set(SKILLS);

const SIZES = new Set(["tiny", "sm", "med", "lg", "huge", "grg"]);

const VALID_ACTOR_TYPES = new Set(["character", "npc", "vehicle", "group"]);

const VALID_ITEM_TYPES = new Set([
  "weapon", "equipment", "consumable", "tool", "loot", "container",
  "class", "subclass", "spell", "feat", "background", "race",
  "facility", "tattoo",
]);

const WEAPON_TYPES = new Set([
  "simpleM", "martialM", "simpleR", "martialR", "natural", "improv", "siege",
]);

const ACTION_TYPES = new Set([
  "mwak", "rwak", "msak", "rsak", "save", "abil", "util", "heal", "ench", "summ", "other",
]);

const DAMAGE_TYPES = new Set([
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
  "healing", "temphp", "none",
]);

const PREP_MODES = new Set(["prepared", "pact", "atwill", "innate", "always"]);

const SPELL_LEVEL_MIN = 0;
const SPELL_LEVEL_MAX = 9;

const ABILITY_SCORE_MIN = 1;
const ABILITY_SCORE_MAX = 30;

// Computed paths — Foundry silently no-ops writes to these; we reject
// upfront with a hint pointing to the underlying value the user should
// touch instead. This is the single biggest dnd5e gotcha.
const COMPUTED_PATH_LITERALS = new Set([
  "system.attributes.prof",
  "system.attributes.spelldc",
  "system.attributes.ac.value",
  "system.details.level",
]);

const COMPUTED_PATH_PATTERNS = [
  /^system\.abilities\.\w+\.mod$/,
  /^system\.abilities\.\w+\.save$/,
  /^system\.abilities\.\w+\.dc$/,
  /^system\.skills\.\w+\.total$/,
  /^system\.skills\.\w+\.passive$/,
];

function isComputedPath(path) {
  if (COMPUTED_PATH_LITERALS.has(path)) return true;
  return COMPUTED_PATH_PATTERNS.some((re) => re.test(path));
}

function computedHint(path) {
  if (path.endsWith(".mod") || path.endsWith(".save") || path.endsWith(".dc")) {
    return "Set system.abilities.<key>.value (raw score) instead.";
  }
  if (path.endsWith(".total") || path.endsWith(".passive")) {
    return "Set system.skills.<key>.value (proficiency multiplier) and .ability instead.";
  }
  if (path === "system.attributes.prof") return "Proficiency is computed from level/CR.";
  if (path === "system.attributes.spelldc") return "Spell DC is computed from class.";
  if (path === "system.attributes.ac.value") return "AC computes from armor on PCs; use system.attributes.ac.flat for NPCs.";
  if (path === "system.details.level") return "Level computes from class items; add/update class items instead.";
  return "Computed field — write the underlying value.";
}

export const dnd5eServer = Object.freeze({
  id: SYSTEM_ID,

  // Exposed for client-side mirror.
  abilities: ABILITIES,
  skills: SKILLS,

  validateActorSpec(spec) {
    const errors = [];

    if (spec.type && !VALID_ACTOR_TYPES.has(spec.type)) {
      errors.push({ path: "type", expected: [...VALID_ACTOR_TYPES], received: spec.type });
    }

    const sys = spec.system;
    if (!sys) return { ok: errors.length === 0, errors };

    // Abilities — keys and 1-30 score range.
    if (sys.abilities && typeof sys.abilities === "object") {
      for (const [ab, payload] of Object.entries(sys.abilities)) {
        if (!ABILITY_SET.has(ab)) {
          errors.push({ path: `system.abilities.${ab}`, error: "unknown ability key", valid: ABILITIES });
          continue;
        }
        const score = payload?.value;
        if (score !== undefined) {
          if (!Number.isInteger(score) || score < ABILITY_SCORE_MIN || score > ABILITY_SCORE_MAX) {
            errors.push({
              path: `system.abilities.${ab}.value`,
              expected: `integer ${ABILITY_SCORE_MIN}-${ABILITY_SCORE_MAX}`,
              received: score,
            });
          }
        }
        const prof = payload?.proficient;
        if (prof !== undefined && ![0, 0.5, 1].includes(prof)) {
          errors.push({
            path: `system.abilities.${ab}.proficient`,
            expected: "0 | 0.5 | 1",
            received: prof,
          });
        }
      }
    }

    // Skills — keys, proficiency multiplier, and ability default.
    if (sys.skills && typeof sys.skills === "object") {
      for (const [sk, payload] of Object.entries(sys.skills)) {
        if (!SKILL_SET.has(sk)) {
          errors.push({ path: `system.skills.${sk}`, error: "unknown skill key", valid: SKILLS });
          continue;
        }
        const v = payload?.value;
        if (v !== undefined && ![0, 0.5, 1, 2].includes(v)) {
          errors.push({
            path: `system.skills.${sk}.value`,
            expected: "0 | 0.5 | 1 | 2 (proficiency multiplier)",
            received: v,
          });
        }
        const ab = payload?.ability;
        if (ab !== undefined && !ABILITY_SET.has(ab)) {
          errors.push({
            path: `system.skills.${sk}.ability`,
            expected: ABILITIES,
            received: ab,
          });
        }
      }
    }

    // Size.
    if (sys.traits?.size !== undefined && !SIZES.has(sys.traits.size)) {
      errors.push({
        path: "system.traits.size",
        expected: [...SIZES],
        received: sys.traits.size,
      });
    }

    return { ok: errors.length === 0, errors };
  },

  validateItemSpec(spec) {
    const errors = [];

    if (spec.type && !VALID_ITEM_TYPES.has(spec.type)) {
      errors.push({ path: "type", expected: [...VALID_ITEM_TYPES], received: spec.type });
    }

    const sys = spec.system;
    if (!sys) return { ok: errors.length === 0, errors };

    // Spell level 0-9, prep mode.
    if (spec.type === "spell") {
      const level = sys.level;
      if (level !== undefined) {
        if (!Number.isInteger(level) || level < SPELL_LEVEL_MIN || level > SPELL_LEVEL_MAX) {
          errors.push({
            path: "system.level",
            expected: `integer ${SPELL_LEVEL_MIN}-${SPELL_LEVEL_MAX}`,
            received: level,
          });
        }
      }
      const mode = sys.preparation?.mode;
      if (mode !== undefined && !PREP_MODES.has(mode)) {
        errors.push({ path: "system.preparation.mode", expected: [...PREP_MODES], received: mode });
      }
    }

    // Weapon type and action type.
    if (spec.type === "weapon" && sys.weaponType !== undefined && !WEAPON_TYPES.has(sys.weaponType)) {
      errors.push({ path: "system.weaponType", expected: [...WEAPON_TYPES], received: sys.weaponType });
    }
    if (sys.actionType !== undefined && !ACTION_TYPES.has(sys.actionType)) {
      errors.push({ path: "system.actionType", expected: [...ACTION_TYPES], received: sys.actionType });
    }

    // Damage parts: array of [formula, damageType] tuples.
    if (sys.damage?.parts !== undefined) {
      if (!Array.isArray(sys.damage.parts)) {
        errors.push({
          path: "system.damage.parts",
          expected: "array of [formula, damageType] tuples",
          received: typeof sys.damage.parts,
        });
      } else {
        for (let i = 0; i < sys.damage.parts.length; i++) {
          const part = sys.damage.parts[i];
          if (!Array.isArray(part) || part.length !== 2) {
            errors.push({
              path: `system.damage.parts[${i}]`,
              expected: "[formula, damageType]",
              received: part,
            });
            continue;
          }
          if (typeof part[0] !== "string") {
            errors.push({
              path: `system.damage.parts[${i}][0]`,
              expected: "formula string",
              received: typeof part[0],
            });
          }
          if (typeof part[1] === "string" && !DAMAGE_TYPES.has(part[1])) {
            errors.push({
              path: `system.damage.parts[${i}][1]`,
              expected: [...DAMAGE_TYPES],
              received: part[1],
            });
          }
        }
      }
    }

    // Save ability when present.
    if (sys.save?.ability !== undefined && !ABILITY_SET.has(sys.save.ability)) {
      errors.push({ path: "system.save.ability", expected: ABILITIES, received: sys.save.ability });
    }

    return { ok: errors.length === 0, errors };
  },

  validateUpdatePath(path /* , kind */) {
    if (typeof path !== "string") return { ok: false, error: "path must be a string" };

    // Universal paths are always allowed.
    if (path === "name" || path === "img" || path.startsWith("prototypeToken.")) {
      return { ok: true };
    }

    // Reject computed paths with a helpful hint — Foundry would silently
    // no-op these writes, which is the worst kind of bug.
    if (isComputedPath(path)) {
      return {
        ok: false,
        error: `Path '${path}' is computed. ${computedHint(path)}`,
      };
    }

    return { ok: true };
  },

  composeActorSummary(actor) {
    const sys = actor?.system ?? {};
    const isPC = actor.type === "character";
    const hp = sys.attributes?.hp;
    const ac = sys.attributes?.ac?.value ?? sys.attributes?.ac?.flat;

    const parts = [];

    if (isPC) {
      const level = sys.details?.level;
      const className = primaryClassName(actor);
      const tag = [
        Number.isFinite(level) ? `Level ${level}` : "",
        className,
      ].filter(Boolean).join(" ");
      parts.push(tag ? `${actor.name} — ${tag}` : actor.name);
    } else {
      const cr = sys.details?.cr;
      const creatureType = sys.details?.type?.value ?? sys.details?.type;
      const tag = [
        cr !== undefined && cr !== null ? `CR ${cr}` : "",
        typeof creatureType === "string" ? creatureType : "",
      ].filter(Boolean).join(" ");
      parts.push(tag ? `${actor.name} — ${tag}` : `${actor.name} — ${actor.type}`);
    }

    if (hp && Number.isFinite(hp.value) && Number.isFinite(hp.max)) {
      parts.push(`HP ${hp.value}/${hp.max}`);
    }
    if (Number.isFinite(ac)) {
      parts.push(`AC ${ac}`);
    }

    return parts.join(", ") + ".";
  },
});

/**
 * Find the primary class on an Actor for summary composition. dnd5e
 * stores classes as Item documents on the Actor; the "primary" class is
 * the one with the highest `system.levels` field.
 */
function primaryClassName(actor) {
  const classes = (actor.items?.contents ?? actor.items?.values?.() ?? [])
    ? Array.from(actor.items?.contents ?? actor.items?.values?.() ?? [])
    : [];
  const classItems = [...classes].filter((i) => i?.type === "class");
  if (classItems.length === 0) return "";
  classItems.sort((a, b) => (b.system?.levels ?? 0) - (a.system?.levels ?? 0));
  return classItems[0].name ?? "";
}
