/**
 * Foundry Voice Control — Warhammer: The Old World — client executors.
 *
 * Implements the client-side of the system handler: actually rolling
 * dice, posting chat messages, computing summaries.
 *
 * VERIFY: The WH:TOW Foundry system's roll API is the biggest unknown.
 * This file implements the d10-pool mechanic from the rules using
 * Foundry's universal `Roll` class so it works regardless of whether the
 * system exposes a dedicated roll method. If the system DOES expose
 * `actor.rollTest(charKey, skillKey)` (or similar), prefer that — it
 * will surface system-specific dialog flows like Grim/Glorious that
 * we'd otherwise re-implement.
 *
 * Where this file says VERIFY, swap the call to the system's native
 * method when known.
 */

const SYSTEM_ID = "whtow"; // VERIFY at install — must match server-side handler

// Skill → parent Char (mirror of server-side WH:TOW handler).
const SKILL_TO_CHAR = Object.freeze({
  melee: "ws", defence: "ws",
  shooting: "bs", throwing: "bs",
  brawn: "s", toil: "s",
  survival: "t", endurance: "t",
  awareness: "i", dexterity: "i",
  athletics: "ag", stealth: "ag",
  willpower: "re", recall: "re",
  leadership: "fel", charm: "fel",
});

const OUTCOME_LABELS = ["Failure", "Marginal Success", "Success", "Total Success"];

export const whtowClient = Object.freeze({
  id: SYSTEM_ID,

  /**
   * use_item — drives the system's per-item-type flow. We try the
   * system's native method first; falls back to a generic roll based on
   * item type.
   */
  async useItem(actor, item, options = {}) {
    // VERIFY: try the system's native item.use() / item.roll() if it
    // exists. Common shapes from Cubicle 7 systems:
    if (typeof item.roll === "function") {
      const result = await item.roll(options);
      return {
        summary: composeUseItemSummary(item, result),
        data: { result_kind: "system-native", chat_message_id: result?.message?.id ?? null },
      };
    }

    // Generic fallback by type.
    if (item.type === "weapon") {
      return weaponAttack(actor, item, options);
    }
    if (item.type === "spell") {
      return castSpell(actor, item, options);
    }
    if (item.type === "prayer" || item.type === "blessing") {
      return offerPrayer(actor, item, options);
    }

    // Unknown item type — render a chat message with the item name.
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `${actor.name} uses <strong>${item.name}</strong>.`,
    });
    return { summary: `${actor.name} used ${item.name}.`, data: { result_kind: "narration" } };
  },

  /**
   * roll — kind dispatch. WH:TOW collapses skill/save into the same
   * test; attack uses an item; custom takes a free formula.
   */
  async roll(actor, kind, target, options = {}) {
    if (kind === "custom") {
      return customRoll(actor, target, options);
    }
    if (kind === "attack") {
      const item = actor.items.get(target) ?? actor.items.getName?.(target);
      if (!item) throw clientError("not_found", `Item '${target}' not found on ${actor.name}.`);
      return weaponAttack(actor, item, options);
    }
    // skill / save → test
    const { char, skill } = parseTestTarget(target);
    return runTest(actor, char, skill, options);
  },
});

// ---------- WH:TOW d10 pool roll ----------

async function runTest(actor, charKey, skillKey, options = {}) {
  const sys = actor.system ?? {};
  const char = Number(sys.characteristics?.[charKey]?.value ?? 0);
  const skill = Number(sys.skills?.[skillKey]?.rating ?? 0);
  if (!Number.isFinite(char) || char < 1) {
    throw clientError(
      "validation",
      `Actor '${actor.name}' has no Characteristic '${charKey}'.`,
    );
  }

  const bonusDice = Number(options.bonusDice ?? 0);
  const penaltyDice = Number(options.penaltyDice ?? 0);
  let pool = char + bonusDice - penaltyDice;
  pool = Math.max(0, Math.min(pool, 2 * char)); // clamp 0..2x Characteristic

  let warning = null;
  let dice = [];
  let successes = 0;
  if (pool < 1) {
    // Sub-1 special: roll 1d10, succeeds only on 1.
    const r = await new Roll("1d10").evaluate({ async: true });
    dice = r.terms[0]?.results?.map((t) => t.result) ?? [];
    successes = dice[0] === 1 ? 1 : 0;
    warning = "Pool below 1; rolled 1d10, succeeds only on 1.";
  } else {
    const r = await new Roll(`${pool}d10`).evaluate({ async: true });
    dice = r.terms[0]?.results?.map((t) => t.result) ?? [];
    successes = dice.filter((d) => d <= skill).length;
  }

  // Apply Grim / Glorious. They cancel.
  const grim = !!options.grim && !options.glorious;
  const glorious = !!options.glorious && !options.grim;

  if (grim) {
    // Reroll all successes.
    const successIndexes = [];
    dice.forEach((d, i) => {
      if (d <= skill) successIndexes.push(i);
    });
    if (successIndexes.length > 0) {
      const r = await new Roll(`${successIndexes.length}d10`).evaluate({ async: true });
      const newDice = r.terms[0]?.results?.map((t) => t.result) ?? [];
      successIndexes.forEach((idx, j) => {
        dice[idx] = newDice[j] ?? dice[idx];
      });
      successes = dice.filter((d) => d <= skill).length;
    }
  } else if (glorious) {
    // Reroll all failures.
    const failIndexes = [];
    dice.forEach((d, i) => {
      if (d > skill) failIndexes.push(i);
    });
    if (failIndexes.length > 0) {
      const r = await new Roll(`${failIndexes.length}d10`).evaluate({ async: true });
      const newDice = r.terms[0]?.results?.map((t) => t.result) ?? [];
      failIndexes.forEach((idx, j) => {
        dice[idx] = newDice[j] ?? dice[idx];
      });
      successes = dice.filter((d) => d <= skill).length;
    }
  }

  const outcomeIdx = Math.min(successes, 3);
  const outcome = OUTCOME_LABELS[outcomeIdx];
  const charLabel = charKey.toUpperCase();
  const skillLabel = capitalize(skillKey);

  // Post a chat message with the result.
  const flavor = `${charLabel}${skillKey ? `:${skillLabel}` : ""} test`;
  const dieList = dice.join(", ");
  const content = `<strong>${flavor}</strong><br>` +
    `Pool: ${pool || 1}d10 (≤${skill})<br>` +
    `Rolled: ${dieList}<br>` +
    `<strong>${outcome}</strong> (${successes} success${successes === 1 ? "" : "es"})${grim ? " · Grim" : ""}${glorious ? " · Glorious" : ""}`;
  const chat = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
  });

  return {
    summary: `${charLabel}:${skillLabel} test — ${outcome.toLowerCase()} (${successes} success${successes === 1 ? "" : "es"}).`,
    data: {
      formula: `${pool || 1}d10`,
      pool,
      threshold: skill,
      dice,
      successes,
      outcome: outcomeKey(outcomeIdx),
      grim,
      glorious,
      chat_message_id: chat?.id ?? null,
      warning,
    },
  };
}

async function weaponAttack(actor, weapon, options) {
  const skillKey = weapon.system?.skill ?? "melee";
  const charKey = SKILL_TO_CHAR[skillKey] ?? "ws";
  const result = await runTest(actor, charKey, skillKey, options);
  // Damage in WH:TOW combines weapon damage rating with extra successes.
  const dmgRating = Number(weapon.system?.damage ?? 0);
  const successes = result.data?.successes ?? 0;
  const damage = successes > 0 ? dmgRating + Math.max(0, successes - 1) : 0;
  const summary =
    successes > 0
      ? `${weapon.name}: ${successes} success${successes === 1 ? "" : "es"} — ${damage} damage.`
      : `${weapon.name}: missed.`;
  return {
    summary,
    data: { ...result.data, weapon_id: weapon.id, weapon_damage_rating: dmgRating, damage },
  };
}

async function castSpell(actor, spell, options) {
  // Casting in WH:TOW is a Test against a relevant Char/Skill stored on
  // the spell. VERIFY paths.
  const charKey = spell.system?.castingTest?.characteristic ?? "re";
  const skillKey = spell.system?.castingTest?.skill ?? "willpower";
  const result = await runTest(actor, charKey, skillKey, options);
  const successes = result.data?.successes ?? 0;
  let summary;
  if (successes >= 3) summary = `${spell.name} cast — total success.`;
  else if (successes === 2) summary = `${spell.name} cast successfully.`;
  else if (successes === 1) summary = `${spell.name} cast with a complication.`;
  else summary = `${spell.name} failed.`;
  // Miscast detection requires system-specific hooks; not implemented here.
  return { summary, data: { ...result.data, spell_id: spell.id } };
}

async function offerPrayer(actor, prayer, options) {
  const charKey = prayer.system?.test?.characteristic ?? "re";
  const skillKey = prayer.system?.test?.skill ?? "willpower";
  const deity = prayer.system?.deity ?? "deity";
  const result = await runTest(actor, charKey, skillKey, options);
  const successes = result.data?.successes ?? 0;
  const outcome = OUTCOME_LABELS[Math.min(successes, 3)].toLowerCase();
  return {
    summary: `Prayer to ${deity}: ${outcome}.`,
    data: { ...result.data, prayer_id: prayer.id, deity },
  };
}

async function customRoll(actor, formula, options) {
  if (typeof formula !== "string") {
    throw clientError("validation", "Custom roll target must be a formula string.");
  }
  const r = await new Roll(formula, actor.getRollData?.() ?? {}).evaluate({ async: true });
  await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }) });
  return {
    summary: `Rolled ${r.formula}: total ${r.total}.`,
    data: { formula: r.formula, total: r.total, results: extractResults(r) },
  };
}

// ---------- helpers ----------

function parseTestTarget(target) {
  if (typeof target !== "string") {
    throw clientError("validation", "Test target must be a string.");
  }
  if (target.includes(":")) {
    const [char, skill] = target.split(":").map((s) => s.trim().toLowerCase());
    return { char, skill };
  }
  // Skill-only — look up parent Char.
  const skill = target.trim().toLowerCase();
  const char = SKILL_TO_CHAR[skill];
  if (!char) {
    throw clientError("validation", `Unknown skill '${skill}'.`, {
      valid: Object.keys(SKILL_TO_CHAR),
    });
  }
  return { char, skill };
}

function composeUseItemSummary(item, result) {
  return `Used ${item.name}.`;
}

function outcomeKey(idx) {
  return ["fail", "marginal", "success", "total"][idx] ?? "fail";
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function extractResults(roll) {
  return roll.terms.flatMap((t) => (t.results ?? []).map((r) => r.result));
}

function clientError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.summary = message;
  err.details = details;
  return err;
}
