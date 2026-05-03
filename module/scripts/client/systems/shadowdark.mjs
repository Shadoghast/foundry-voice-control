/**
 * Foundry Voice Control — Shadowdark — client executors.
 *
 * Implements the client-side of the system handler: actually rolling
 * dice, posting chat messages, computing summaries.
 *
 * Strategy: prefer the system's native methods when available
 * (`item.use()` / `item.roll()`), fall back to a rules-pure
 * implementation using Foundry's universal `Roll` class so the module
 * works against fresh Shadowdark installs that may not yet expose those
 * helpers.
 *
 * VERIFY: per-system Foundry path naming (`actor.system.abilities.<key>.value`,
 * weapon damage at `system.damage.value`, spell tier at `system.tier`,
 * etc.). The defaults here match the documented shape in
 * references/systems/shadowdark.md; swap as needed at install.
 */

const SYSTEM_ID = "shadowdark"; // VERIFY at install

const ABILITY_KEYS = new Set(["str", "dex", "con", "int", "wis", "cha"]);

export const shadowdarkClient = Object.freeze({
  id: SYSTEM_ID,

  /**
   * use_item — drives the per-item-type flow. Tries the system's native
   * method first; falls back to a generic flow per type.
   */
  async useItem(actor, item, options = {}) {
    if (typeof item.use === "function") {
      const result = await item.use(options);
      return composeNativeUseResult(item, result);
    }
    if (typeof item.roll === "function") {
      const result = await item.roll(options);
      return composeNativeUseResult(item, result);
    }

    const type = (item.type ?? "").toLowerCase();
    if (type === "weapon") return weaponAttack(actor, item, options);
    if (type === "spell" || type === "wand" || type === "scroll" || type === "potion") {
      return castSpell(actor, item, options);
    }
    if (isLightSource(item)) {
      return toggleLight(actor, item, options);
    }

    // Generic narration.
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `${actor.name} uses <strong>${item.name}</strong>.`,
    });
    return {
      summary: `${actor.name} used ${item.name}.`,
      data: { result_kind: "narration" },
    };
  },

  /**
   * roll — kind dispatch. Shadowdark folds saves into ability checks
   * (same mechanic, different DC), so `kind: "skill"` and `kind: "save"`
   * both route to the same call.
   */
  async roll(actor, kind, target, options = {}) {
    if (kind === "custom") {
      return customRoll(actor, target, options);
    }
    if (kind === "attack") {
      const item = actor.items.get(target) ?? actor.items.getName?.(target);
      if (!item) {
        throw clientError("not_found", `Item '${target}' not found on ${actor.name}.`);
      }
      return weaponAttack(actor, item, options);
    }
    // skill / save → ability check.
    return abilityCheck(actor, target, options);
  },
});

// ---------- ability check / save ----------

async function abilityCheck(actor, abilityKey, options) {
  const ab = String(abilityKey ?? "").toLowerCase();
  if (!ABILITY_KEYS.has(ab)) {
    throw clientError("validation", `Unknown ability '${abilityKey}'.`, {
      valid: [...ABILITY_KEYS],
    });
  }

  const sys = actor.system ?? {};
  const score = Number(sys.abilities?.[ab]?.value ?? 10);
  const mod = Math.floor((score - 10) / 2);

  // Advantage / disadvantage / Luck Token (PCs only). Luck currently maps
  // to advantage for the v1 implementation; richer Luck handling — burning
  // the token vs. rerolling — needs system-specific hooks.
  const adv = !!options.advantage || (!!options.use_luck && actor.type?.toLowerCase() === "player");
  const dis = !!options.disadvantage && !adv;

  const formula = adv ? "2d20kh1" : dis ? "2d20kl1" : "1d20";
  const r = await new Roll(`${formula} + ${mod}`).evaluate();

  const die = extractFirstDie(r);
  const crit = die === 20;
  const fumble = die === 1;

  const flavor = `${ab.toUpperCase()} check`;
  const chat = await r.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
  });

  const note = crit ? " — crit." : fumble ? " — fumble." : "";
  return {
    summary: `${ab.toUpperCase()} check: ${r.total}${note}`,
    data: {
      formula: r.formula,
      total: r.total,
      die,
      modifier: mod,
      crit,
      fumble,
      luck_used: !!options.use_luck && actor.type?.toLowerCase() === "player",
      chat_message_id: chat?.id ?? null,
    },
  };
}

// ---------- weapon attack ----------

async function weaponAttack(actor, weapon, options) {
  const sys = actor.system ?? {};
  const wsys = weapon.system ?? {};

  // Choose ability: ranged → DEX, melee → STR. `both` defaults to STR
  // unless `options.ranged` is set.
  const wType = (wsys.weaponType ?? "melee").toLowerCase();
  const isRanged = wType === "ranged" || (wType === "both" && options.ranged);
  const ability = isRanged ? "dex" : "str";
  const score = Number(sys.abilities?.[ability]?.value ?? 10);
  const mod = Math.floor((score - 10) / 2);
  const attackBonus = Number(wsys.bonuses?.attack ?? 0);

  const adv = !!options.advantage;
  const dis = !!options.disadvantage && !adv;
  const formula = adv ? "2d20kh1" : dis ? "2d20kl1" : "1d20";

  const attackRoll = await new Roll(
    `${formula} + ${mod} + ${attackBonus}`,
    actor.getRollData?.() ?? {},
  ).evaluate();
  const die = extractFirstDie(attackRoll);
  const crit = die === 20;
  const fumble = die === 1;

  // Damage on non-fumble. Crit doubles dice (per Shadowdark RAW).
  let damageRoll = null;
  let damageTotal = null;
  if (!fumble) {
    const damageDice = wsys.damage?.value ?? "1d4";
    const damageBonus = Number(wsys.bonuses?.damage ?? 0);
    const damageFormula = crit
      ? `(${damageDice}) * 2 + ${mod} + ${damageBonus}`
      : `${damageDice} + ${mod} + ${damageBonus}`;
    damageRoll = await new Roll(
      damageFormula,
      actor.getRollData?.() ?? {},
    ).evaluate();
    damageTotal = damageRoll.total;
  }

  const flavor = `${weapon.name} — ${isRanged ? "ranged" : "melee"} attack`;
  const lines = [
    `<strong>${flavor}</strong>`,
    `Attack: ${attackRoll.total}${crit ? " — crit!" : fumble ? " — fumble" : ""}`,
  ];
  if (damageTotal !== null) lines.push(`Damage: ${damageTotal}`);
  const chat = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: lines.join("<br>"),
  });

  let summary;
  if (fumble) summary = `${weapon.name}: fumble.`;
  else if (crit) summary = `Crit. ${weapon.name}: ${attackRoll.total} to hit, ${damageTotal} damage.`;
  else summary = `${weapon.name}: ${attackRoll.total} to hit, ${damageTotal} damage.`;

  return {
    summary,
    data: {
      weapon_id: weapon.id,
      attack_total: attackRoll.total,
      attack_die: die,
      damage_total: damageTotal,
      crit,
      fumble,
      ability_used: ability,
      chat_message_id: chat?.id ?? null,
    },
  };
}

// ---------- spell cast (with spell-loss flow) ----------

async function castSpell(actor, spell, options) {
  const sys = actor.system ?? {};
  const ssys = spell.system ?? {};

  // Spell check: d20 + level + casting-stat mod vs DC (10 + 2 × tier).
  // Casting stat defaults to INT (wizard); priests use WIS.
  const level = Number(sys.level?.value ?? sys.level ?? 1);
  const castingStat = (ssys.castingStat ?? "int").toLowerCase();
  const score = Number(sys.abilities?.[castingStat]?.value ?? 10);
  const mod = Math.floor((score - 10) / 2);
  const tier = Number(ssys.tier ?? 1);
  const dc = 10 + 2 * tier;

  const adv = !!options.advantage;
  const dis = !!options.disadvantage && !adv;
  const formula = adv ? "2d20kh1" : dis ? "2d20kl1" : "1d20";

  const r = await new Roll(`${formula} + ${level} + ${mod}`).evaluate();
  const die = extractFirstDie(r);
  const crit = die === 20;
  const fumble = die === 1;

  // Outcome ladder per Shadowdark RAW:
  //  - Fumble (nat 1): spell lost permanently for the campaign.
  //  - Total < DC: spell lost for the day.
  //  - Total ≥ DC: success (crit on nat 20 within success).
  let outcome;
  if (fumble) outcome = "fumble";
  else if (r.total >= dc) outcome = crit ? "crit" : "success";
  else outcome = "fail";

  // Mark the spell as lost on failure / fumble.
  // VERIFY: actual flag path on Shadowdark Foundry. References doc lists
  // `system.lost` as the expected location.
  if (outcome === "fail" || outcome === "fumble") {
    try {
      await spell.update({ "system.lost": true });
    } catch {
      // System may not expose `lost` directly; swallow and let the chat
      // message communicate the outcome.
    }
  }

  const modSign = mod >= 0 ? "+" : "";
  const flavor = `${spell.name} — spell check vs DC ${dc}`;
  const lines = [
    `<strong>${flavor}</strong>`,
    `Roll: ${r.total} (d20=${die}, +${level} level, ${modSign}${mod} ${castingStat.toUpperCase()})`,
  ];
  if (outcome === "fumble") {
    lines.push(`<strong style="color:#c33">Miscast — spell lost permanently!</strong>`);
  } else if (outcome === "fail") {
    lines.push(`Failed; spell lost for the day.`);
  } else if (outcome === "crit") {
    lines.push(`<strong style="color:#383">Critical success!</strong>`);
  } else {
    lines.push(`Cast successfully.`);
  }
  const chat = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: lines.join("<br>"),
  });

  let summary;
  if (outcome === "fumble") summary = `${spell.name} miscast — lost permanently.`;
  else if (outcome === "fail") summary = `${spell.name} failed and is lost for the day.`;
  else if (outcome === "crit") summary = `Crit. ${spell.name} cast successfully.`;
  else summary = `${spell.name} cast successfully.`;

  return {
    summary,
    data: {
      spell_id: spell.id,
      tier,
      dc,
      total: r.total,
      die,
      outcome,
      chat_message_id: chat?.id ?? null,
    },
  };
}

// ---------- light tracking ----------

async function toggleLight(actor, item, options) {
  // VERIFY: light-timer mechanism on Shadowdark's Foundry system. The
  // canonical surface (when present) starts a real-time countdown via
  // game.shadowdark.lightTracker.toggle / .start. We try that first; on
  // miss, we fall back to flipping the `system.lit` flag and rendering
  // a chat message — the user can wire the timer manually later.
  const isLit = !!item.system?.lit;
  const tracker = globalThis.game?.shadowdark?.lightTracker;
  let tracked = false;
  if (tracker && typeof tracker.toggle === "function") {
    try {
      await tracker.toggle(item);
      tracked = true;
    } catch {
      // Tracker exists but rejected; fall through to manual flag flip.
    }
  }
  if (!tracked) {
    await item.update({ "system.lit": !isLit });
  }

  const verb = isLit ? "extinguished" : "lit";
  const minutes = item.system?.duration?.value;
  const minutesNote =
    !isLit && Number.isFinite(minutes) ? ` About ${minutes} minutes of light.` : "";

  const chat = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `${actor.name} ${verb} <strong>${item.name}</strong>.${minutesNote}`,
  });

  return {
    summary: `${item.name} ${verb}.${minutesNote}`,
    data: {
      item_id: item.id,
      lit: !isLit,
      duration_minutes: Number.isFinite(minutes) ? minutes : null,
      tracker_used: tracked,
      chat_message_id: chat?.id ?? null,
    },
  };
}

// ---------- custom roll ----------

async function customRoll(actor, formula, options) {
  if (typeof formula !== "string") {
    throw clientError("validation", "Custom roll target must be a formula string.");
  }
  const r = await new Roll(formula, actor.getRollData?.() ?? {}).evaluate();
  const chat = await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }) });
  return {
    summary: `Rolled ${r.formula}: total ${r.total}.`,
    data: {
      formula: r.formula,
      total: r.total,
      chat_message_id: chat?.id ?? null,
    },
  };
}

// ---------- helpers ----------

function isLightSource(item) {
  if (item.system?.duration?.value !== undefined && /torch|lantern|light/i.test(item.name ?? "")) {
    return true;
  }
  return /^(torch|lantern)$/i.test(item.name ?? "");
}

function extractFirstDie(roll) {
  return roll?.dice?.[0]?.results?.[0]?.result ?? null;
}

function composeNativeUseResult(item, result) {
  return {
    summary: `Used ${item.name}.`,
    data: { result_kind: "system-native", chat_message_id: result?.message?.id ?? null },
  };
}

function clientError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.summary = message;
  err.details = details;
  return err;
}
