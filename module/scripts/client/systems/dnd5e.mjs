/**
 * Foundry Voice Control — D&D 5e — client executors.
 *
 * Drives rolls and item use through the dnd5e system's published API:
 *
 *   - actor.rollSkill(key, opts)
 *   - actor.rollSavingThrow(key, opts)  (older versions: rollAbilitySave)
 *   - actor.rollAbilityCheck(key, opts) (older versions: rollAbilityTest)
 *   - item.use({configureDialog: false}, {configureDialog: false})
 *   - item.rollAttack(opts)
 *   - item.rollDamage({critical, ...})
 *
 * Voice posture: pass `fastForward: true` and `configureDialog: false`
 * everywhere so the system never opens its options dialog mid-call.
 * Advantage / disadvantage are surfaced through the `options` payload.
 */

const SYSTEM_ID = "dnd5e";

const ABILITY_KEYS = new Set(["str", "dex", "con", "int", "wis", "cha"]);
const SKILL_KEYS = new Set([
  "acr", "ani", "arc", "ath", "dec", "his",
  "ins", "itm", "inv", "med", "nat", "prc",
  "prf", "per", "rel", "slt", "ste", "sur",
]);

export const dnd5eClient = Object.freeze({
  id: SYSTEM_ID,

  async useItem(actor, item, options = {}) {
    const type = (item.type ?? "").toLowerCase();
    if (type === "weapon") return weaponUse(actor, item, options);
    if (type === "spell") return spellUse(actor, item, options);
    if (type === "consumable") return consumableUse(actor, item, options);
    return genericUse(actor, item, options);
  },

  async roll(actor, kind, target, options = {}) {
    if (kind === "custom") return customRoll(actor, target, options);
    if (kind === "attack") {
      const item = actor.items.get(target) ?? actor.items.getName?.(target);
      if (!item) {
        throw clientError("not_found", `Item '${target}' not found on ${actor.name}.`);
      }
      return weaponAttackOnly(actor, item, options);
    }
    if (kind === "skill") return skillRoll(actor, target, options);
    if (kind === "save") return savingThrow(actor, target, options);
    throw clientError("validation", `Unknown roll kind '${kind}'.`);
  },
});

// ---------- skill / save / check ----------

async function skillRoll(actor, skillKey, options) {
  const key = String(skillKey ?? "").toLowerCase();
  if (!SKILL_KEYS.has(key)) {
    throw clientError("validation", `Unknown skill '${skillKey}'.`, { valid: [...SKILL_KEYS] });
  }
  if (typeof actor.rollSkill !== "function") {
    throw clientError("internal", "actor.rollSkill is not available on this dnd5e version.");
  }
  const opts = makeRollOptions(options);
  const roll = await actor.rollSkill(key, opts);
  if (!roll) return cancelledResult(`Skill ${key.toUpperCase()}`);

  const die = extractFirstDie(roll);
  const label = configLabel("skills", key) ?? key.toUpperCase();
  const note = die === 20 ? " — crit." : die === 1 ? " — fumble." : "";
  return {
    summary: `${label}: ${roll.total}${note}`,
    data: {
      kind: "skill",
      skill: key,
      total: roll.total,
      die,
      formula: roll.formula,
      crit: die === 20,
      fumble: die === 1,
    },
  };
}

async function savingThrow(actor, abilityKey, options) {
  const key = String(abilityKey ?? "").toLowerCase();
  if (!ABILITY_KEYS.has(key)) {
    throw clientError("validation", `Unknown ability '${abilityKey}'.`, { valid: [...ABILITY_KEYS] });
  }
  const opts = makeRollOptions(options);

  // dnd5e v3+ uses rollSavingThrow; older versions used rollAbilitySave.
  const fn =
    typeof actor.rollSavingThrow === "function"
      ? actor.rollSavingThrow.bind(actor)
      : typeof actor.rollAbilitySave === "function"
        ? actor.rollAbilitySave.bind(actor)
        : null;
  if (!fn) {
    throw clientError("internal", "No saving throw method on this dnd5e version.");
  }

  const roll = await fn(key, opts);
  if (!roll) return cancelledResult(`${key.toUpperCase()} save`);

  const die = extractFirstDie(roll);
  const note = die === 20 ? " — crit." : die === 1 ? " — fumble." : "";
  return {
    summary: `${key.toUpperCase()} save: ${roll.total}${note}`,
    data: {
      kind: "save",
      ability: key,
      total: roll.total,
      die,
      formula: roll.formula,
      crit: die === 20,
      fumble: die === 1,
    },
  };
}

// ---------- weapon ----------

/**
 * `roll` with kind "attack" — attack roll only, no damage. Voice flow
 * intentionally splits attack from damage so the user can decide whether
 * the hit lands before damage is rolled (matters at the table).
 */
async function weaponAttackOnly(actor, item, options) {
  if (typeof item.rollAttack !== "function") {
    throw clientError("internal", "item.rollAttack is not available on this dnd5e version.");
  }
  const opts = makeRollOptions(options);
  const attackRoll = await item.rollAttack(opts);
  if (!attackRoll) return cancelledResult(item.name);

  const die = extractFirstDie(attackRoll);
  const crit = die === 20;
  const fumble = die === 1;
  const note = crit ? " — crit." : fumble ? " — fumble." : "";
  return {
    summary: `${item.name}: ${attackRoll.total} to hit${note}`,
    data: {
      kind: "attack",
      item_id: item.id,
      attack_total: attackRoll.total,
      attack_die: die,
      crit,
      fumble,
    },
  };
}

/**
 * `use_item` on a weapon — attack roll, then damage roll on hit
 * (non-fumble). Both rolls produce structured output for voice.
 */
async function weaponUse(actor, item, options) {
  if (typeof item.rollAttack !== "function") {
    // Fall back to the system's `item.use()` for the full flow.
    return genericUse(actor, item, options);
  }
  const opts = makeRollOptions(options);

  const attackRoll = await item.rollAttack(opts);
  if (!attackRoll) return cancelledResult(item.name);

  const die = extractFirstDie(attackRoll);
  const crit = die === 20;
  const fumble = die === 1;

  let damageTotal = null;
  let damageType = primaryDamageType(item);
  if (!fumble && typeof item.rollDamage === "function") {
    const damageRoll = await item.rollDamage({ ...opts, critical: crit });
    if (damageRoll) damageTotal = damageRoll.total;
  }

  let summary;
  if (fumble) summary = `${item.name}: fumble.`;
  else if (crit) summary = `Crit. ${item.name}: ${attackRoll.total} to hit, ${damageTotal} ${damageType}.`;
  else summary = `${item.name}: ${attackRoll.total} to hit, ${damageTotal} ${damageType}.`;

  return {
    summary,
    data: {
      item_id: item.id,
      attack_total: attackRoll.total,
      attack_die: die,
      damage_total: damageTotal,
      damage_type: damageType,
      crit,
      fumble,
    },
  };
}

// ---------- spell ----------

async function spellUse(actor, item, options) {
  if (typeof item.use !== "function") {
    throw clientError("internal", "item.use is not available on this dnd5e version.");
  }
  const useOpts = { configureDialog: false, fastForward: true };
  if (Number.isInteger(options?.slot_level)) useOpts.slotLevel = options.slot_level;
  if (options?.advantage) useOpts.advantage = true;
  if (options?.disadvantage) useOpts.disadvantage = true;

  // dnd5e's item.use signature has shifted across versions; passing the
  // same opts object both positionally is the safe form.
  await item.use(useOpts, useOpts);

  const sys = item.system ?? {};
  const dc = sys.save?.dc;
  const saveAbility = sys.save?.ability;
  const slotLevel = useOpts.slotLevel ?? sys.level;

  let summary;
  if (saveAbility && Number.isFinite(dc)) {
    summary = `${item.name} cast — ${saveAbility.toUpperCase()} save DC ${dc}.`;
  } else if (sys.actionType === "rsak" || sys.actionType === "msak") {
    summary = `${item.name} cast — spell attack.`;
  } else if (sys.actionType === "heal") {
    summary = `${item.name} cast — healing.`;
  } else {
    summary = `${item.name} cast.`;
  }

  return {
    summary,
    data: {
      kind: "spell",
      spell_id: item.id,
      level: sys.level ?? null,
      slot_level: slotLevel ?? null,
      save_ability: saveAbility ?? null,
      dc: Number.isFinite(dc) ? dc : null,
      action_type: sys.actionType ?? null,
    },
  };
}

// ---------- consumable / generic ----------

async function consumableUse(actor, item, options) {
  if (typeof item.use !== "function") {
    return genericUse(actor, item, options);
  }
  const useOpts = { configureDialog: false, fastForward: true };
  await item.use(useOpts, useOpts);

  const remaining = item.system?.uses?.value;
  const max = item.system?.uses?.max;
  const remainingNote = Number.isFinite(remaining) && Number.isFinite(max)
    ? `, ${remaining}/${max} remaining`
    : "";

  return {
    summary: `Used ${item.name}${remainingNote}.`,
    data: {
      kind: "consumable",
      item_id: item.id,
      remaining: Number.isFinite(remaining) ? remaining : null,
      max: Number.isFinite(max) ? max : null,
    },
  };
}

async function genericUse(actor, item, options) {
  if (typeof item.use === "function") {
    const useOpts = { configureDialog: false, fastForward: true };
    await item.use(useOpts, useOpts);
    return {
      summary: `Used ${item.name}.`,
      data: { kind: "generic", item_id: item.id, result_kind: "system-native" },
    };
  }
  // Last-resort narration.
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `${actor.name} uses <strong>${item.name}</strong>.`,
  });
  return {
    summary: `${actor.name} used ${item.name}.`,
    data: { kind: "narration", item_id: item.id },
  };
}

// ---------- custom ----------

async function customRoll(actor, formula, options) {
  if (typeof formula !== "string") {
    throw clientError("validation", "Custom roll target must be a formula string.");
  }
  const r = await new Roll(formula, actor.getRollData?.() ?? {}).evaluate();
  const chat = await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }) });
  return {
    summary: `Rolled ${r.formula}: total ${r.total}.`,
    data: { formula: r.formula, total: r.total, chat_message_id: chat?.id ?? null },
  };
}

// ---------- helpers ----------

function makeRollOptions(options = {}) {
  const opts = { fastForward: true, configureDialog: false };
  if (options.advantage) opts.advantage = true;
  if (options.disadvantage) opts.disadvantage = true;
  if (typeof options.bonus === "string") opts.bonus = options.bonus;
  return opts;
}

function extractFirstDie(roll) {
  // Walk terms looking for the first d20 die; falls back to first die of any kind.
  const terms = roll?.terms ?? roll?.dice ?? [];
  for (const t of terms) {
    if (t?.faces === 20 && Array.isArray(t.results) && t.results.length > 0) {
      return t.results[0].result;
    }
  }
  // Some rolls have dice on `roll.dice` separately.
  const dice = roll?.dice ?? [];
  for (const d of dice) {
    if (Array.isArray(d?.results) && d.results.length > 0) {
      return d.results[0].result;
    }
  }
  return null;
}

function configLabel(group, key) {
  const cfg = globalThis.game?.dnd5e?.config?.[group];
  if (!cfg) return null;
  const entry = cfg[key];
  if (typeof entry === "string") return entry;
  return entry?.label ?? null;
}

function primaryDamageType(item) {
  // sys.damage.parts is `[[formula, type], ...]`. First entry's type is the
  // primary; default to "damage" when nothing's specified.
  const parts = item.system?.damage?.parts;
  if (Array.isArray(parts) && parts.length > 0) {
    const first = parts[0];
    if (Array.isArray(first) && typeof first[1] === "string") return first[1];
  }
  return "damage";
}

function cancelledResult(label) {
  return {
    summary: `${label}: cancelled.`,
    data: { cancelled: true },
  };
}

function clientError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.summary = message;
  err.details = details;
  return err;
}
