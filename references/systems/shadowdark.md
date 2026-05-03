# Shadowdark RPG (`shadowdark`)

Per-system reference for the Shadowdark RPG Foundry system (Arcane Library / Kelsey Dionne). Used by recipes for system-gated tools.

> **Verify on implementation.** The Foundry implementation of Shadowdark is younger than `dnd5e`, with paths still occasionally shifting between releases. This doc captures the *shape* I'm confident about; entries marked **VERIFY** need to be confirmed against `game.system` at implementation time. Do not copy untested paths into the validation logic.
>
> **System id check.** Confirm `game.system.id === "shadowdark"` at boot. There is also a separate community OSR-shadowdark-style system in the wild; the official implementation is `shadowdark`.

**Doc baseline:** The official Shadowdark Foundry system, latest stable release on Foundry v14. Path specifics validated against `game.system.documentTypes` and `game.shadowdark` (or equivalent) at module init.

## Mechanics in one paragraph

Everything is `1d20 + ability mod + bonuses` against a DC. Abilities are STR/DEX/CON/INT/WIS/CHA on the standard 3–18 range; modifier is the usual `(score − 10) / 2` floor. Levels run 1–10. AC starts at 10 + DEX mod + armor. Spells use a **spell check** — `1d20 + level + casting-stat mod` against DC `10 + 2 × spell tier`. Tiers run 1–5. Crits on natural 20, fumbles on natural 1. Movement is categorical: `close`, `near`, `far` rather than feet (one of the things that makes Shadowdark ergonomic for theater-of-the-mind play). Light is a real-time tracked resource at the table (torches burn for ~1 hour real time). PCs have **Luck Tokens** they can spend for advantage.

## Actor types

| Type | Use |
|------|-----|
| `Player` | PCs (also called "Character" in some builds — **VERIFY** the exact subtype string) |
| `NPC` | Hostile and friendly NPCs |
| `Hazard` | Traps and environmental hazards (some Shadowdark builds; **VERIFY**) |
| `Light` | Light source actor — tracks burn-down (**VERIFY** whether this is its own actor type or an item) |

Confirm the exact subtype strings from `game.system.documentTypes.Actor` keys at module init. Reject `create_actor` for any type not in that set.

## Actor schema (key paths)

The structure below is the *expected shape* — exact dot-path strings need verification against the live system. Reasoning is documented next to each so you can fix any drift quickly.

### Universal

| Path | Type | Notes |
|------|------|-------|
| `name` | string | |
| `img` | path | |
| `prototypeToken.texture.src` | path | |
| `system.attributes.hp.value` | int | Current HP |
| `system.attributes.hp.max` | int | Max HP |
| `system.attributes.ac.value` | int | **VERIFY:** may be `system.attributes.ac` flat in some builds. AC is 10 + DEX mod + armor. |
| `system.level.value` | int | 1–10 — **VERIFY** path; could also be `system.level` directly. |
| `system.abilities.<a>.value` | int | Score 3–18; `a ∈ {str, dex, con, int, wis, cha}` |
| `system.abilities.<a>.mod` | int | **Computed.** Read-only. |
| `system.attributes.move` | string | `close | near | far` (**VERIFY** path) |
| `system.coins.gp` / `.sp` / `.cp` | int | **VERIFY** — could also be flat under `system.gp` etc. |
| `system.alignment` | string | `lawful | neutral | chaotic` |
| `system.languages` | array | Language strings |
| `system.bonuses.attack` | int | Generic attack bonus (**VERIFY**) |
| `system.bonuses.dmg` | int | Generic damage bonus (**VERIFY**) |

### `Player`-only

| Path | Type | Notes |
|------|------|-------|
| `system.luck` | int | Luck Tokens (PC-only) — **VERIFY** path |
| `system.title` | string | Title band (e.g. "Squire", "Knight") — usually **computed** from class + level |
| `system.deity` | string | For priests |
| `system.background` | string | Or stored as a background item — **VERIFY** which |
| `system.ancestry` | string | Or stored as an ancestry item — **VERIFY** |
| `system.class` | string | Or stored as a class item — **VERIFY** |
| `system.xp` | int | XP track |

### `NPC`-only

| Path | Type | Notes |
|------|------|-------|
| `system.attributes.attacksText` | string | NPC attack stat-block prose |
| `system.attributes.specialText` | string | Special abilities prose |
| `system.attributes.move` | string | `close | near | far` (often modified per NPC) |
| `system.morale` | int | NPC morale (Shadowdark has morale checks) — **VERIFY** path |
| `system.alignment` | string | |
| `system.flavor` | string | Brief description |

### Light actors (if separate type)

If Shadowdark exposes Light as an actor type:

| Path | Type | Notes |
|------|------|-------|
| `system.duration.value` | int | Remaining minutes |
| `system.duration.max` | int | Original duration |
| `system.intensity` | string | `bright | dim | none` (**VERIFY**) |
| `system.lit` | bool | Currently burning |

If Light is instead an item placed on a Player actor, paths shift accordingly. `add_item` will need a `lightSource` item type validation.

## Item types

Expected types: `Weapon, Armor, Gear, Spell, Talent, Ability, Effect, Class, Ancestry, Background, NPC Attack, NPC Special, Wand, Scroll, Potion`. **VERIFY** the exact subtype strings from `game.system.documentTypes.Item`.

Common `system.*` paths by type:

### `Weapon`

| Path | Notes |
|------|-------|
| `system.damage.value` | e.g. `"1d6"` |
| `system.damage.versatile` | optional |
| `system.weaponType` | `melee | ranged | both` |
| `system.range` | `close | near | far` |
| `system.properties` | array — `["finesse", "two-handed", "thrown", ...]` (**VERIFY** keys) |
| `system.bonuses.attack` | int |
| `system.bonuses.damage` | int |
| `system.equipped` | bool |
| `system.stash` | bool — Shadowdark has explicit stash slots |

### `Armor`

| Path | Notes |
|------|-------|
| `system.ac.value` | int — base AC bonus or replacement |
| `system.armorType` | `light | medium | heavy | shield` |
| `system.equipped` | bool |
| `system.properties` | array |

### `Spell`

| Path | Notes |
|------|-------|
| `system.tier` | int — 1–5 |
| `system.duration.value` | mixed — number or "rounds" |
| `system.range` | `close | near | far | self` |
| `system.school` | string (**VERIFY** — Shadowdark doesn't really have schools by RAW; may not exist) |
| `system.lostOnFailure` | bool — Shadowdark spell-loss mechanic |
| `system.castingStat` | string — `int` for wizards, `wis` for priests |

### `Talent`, `Ability`, `Effect`

`Talent` items are the level-up choices. `Ability` is class abilities. `Effect` is in-progress conditions/buffs.

| Path | Notes |
|------|-------|
| `system.source` | string (class / level granted at) |
| `system.activation` | object — passive vs active |

### Other types

`Class`, `Ancestry`, `Background` items are usually static reference data. `NPC Attack` and `NPC Special` are stat-block representations on NPCs. `Wand` / `Scroll` / `Potion` are consumable spell carriers.

## Roll methods

> **VERIFY** all method names against the system source. Shadowdark's Foundry system exposes Actor methods that are likely named similarly to the patterns below but may differ.

```js
// Generic stat check
await actor.rollAbilityCheck(abilityKey, options);

// Attack roll for a weapon
await weaponItem.rollAttack(options);

// Damage roll
await weaponItem.rollDamage(options);

// Spell check
await spellItem.rollSpell(options);  // VERIFY method name
// — or —
await actor.rollSpellCheck(spellItem, options);

// Initiative
await actor.rollInitiative({ createCombatants: true });
```

`options` typically includes:

```js
{
  advantage: bool,
  disadvantage: bool,
  bonus: "+2",          // ad-hoc bonus
  fastForward: true,    // skip dialog
}
```

For voice flows, pass `fastForward: true` and let advantage/disadvantage come from explicit user verbalization.

## Mapping the `roll` tool's `kind` to Shadowdark calls

| `kind` | `target` | Shadowdark call |
|--------|----------|------------------|
| `skill` | Ability key (`"str"`, `"dex"`, etc.) | `actor.rollAbilityCheck(target, opts)` — Shadowdark has no separate skill list; checks ARE ability checks. |
| `save` | Ability key | Same as `skill` — Shadowdark folds saves into ability checks. The DC differs, but the roll mechanic is identical. |
| `attack` | Item id_or_name | `actor.items.get(target).rollAttack(opts)` |
| `custom` | Roll formula | `new Roll(target, actor.getRollData()).roll({async: true})` then post |

Note the `skill` / `save` collapse: it's not a bug, it's the system. Voice can still distinguish ("STR check" vs. "STR save") in the user's request — the underlying roll is the same.

For spell checks, voice will usually phrase it as `use_item` ("cast Burning Hands") rather than `roll`. The `use_item` recipe routes through Shadowdark's spell-check method, including the spell-loss mechanic on a failed check.

## Helper APIs

The Shadowdark system exposes a `game.shadowdark` namespace (**VERIFY**). Useful members:

| Path | Use |
|------|-----|
| `game.shadowdark.config` | Config maps for ability keys, weapon properties, etc. |
| `game.shadowdark.documents.ActorSD` (or similar) | Actor class |
| `game.shadowdark.dice.RollSD` | Programmatic roll wrapper if exposed |

Use `game.shadowdark.config` keys for resolver fuzzy matching of weapon properties, spell tiers, alignment values, etc.

## Light tracking

Shadowdark's torch timer is a real-time mechanic — torches burn for roughly 1 hour real-world time, and the system tracks countdown automatically. For module purposes:

- `use_item` on a torch item should *light* the torch (set its `lit: true` flag) and start the countdown.
- A subsequent `use_item` while lit should *extinguish* it.
- Voice summary should include time remaining when meaningful: `"Torch lit. About 60 minutes of light."`

The exact API for starting / stopping the timer is **VERIFY** territory — likely `game.shadowdark.lightTracker` or similar. Module should expose this through the universal `use_item` flow rather than a dedicated tool, so light works the same as any other item from the user's perspective.

## Spell-loss mechanic

When a spell check fails, the spell is "lost" for the day. The Foundry system tracks this on the spell item, typically via a `system.lost` flag (**VERIFY**). The `use_item` summary template should distinguish the three outcomes:

- **Success:** spell takes effect.
- **Failure (no crit-fumble):** spell is lost, available next day.
- **Critical fumble (nat 1):** spell is lost for the *campaign* until restored — significant.

Voice readback should land the severity:

| Outcome | Summary |
|---------|---------|
| Success | `"<Spell> succeeds<. Effect: ...>."` |
| Failure | `"<Spell> failed and is lost for the day."` |
| Critical fumble | `"<Spell> miscast — lost permanently."` |

## Known gotchas

1. **Movement is categorical, not in feet.** `system.attributes.move` should be `close | near | far`, not a number. Validation must reject numeric movement values with a clear error.
2. **AC is mostly a number, not a computed pile.** Less ambiguity than D&D 5e — usually safe to write `system.attributes.ac.value` directly. But **VERIFY** in case the system computes from armor items.
3. **Saves and skills are the same roll.** Mapping `kind: "skill"` and `kind: "save"` to the same call is correct, not a shortcut.
4. **Ancestry/background/class as items.** Same pattern as dnd5e — likely stored as item documents on the actor, not stat fields. **VERIFY** which.
5. **Light is special.** Lighting a torch involves more than a simple flag flip; it kicks off the system's timer. Always go through the system's lighting API, not a raw `update`.
6. **Luck Tokens.** Voice often phrases this as "use luck for advantage." Expose via the `roll` tool's `options.use_luck: true`, which the Shadowdark handler translates into the system's API. PCs only.
7. **Spell tiers, not levels.** Spells have `tier` (1–5), not `level` (1–9 like D&D). The validation map for `add_item` of a spell must check the right field.
8. **NPCs have prose attacks, not item attacks.** Many Shadowdark NPC stat blocks describe attacks in `system.attributes.attacksText` rather than as Item documents. The `use_item` flow on an NPC may need to fall back to "render the prose" rather than rolling structured attacks. **VERIFY** how the Foundry implementation handles this.
9. **Crit / fumble emphasis.** The system already auto-flags crits; voice readbacks just lead with the word ("Crit." or "Fumble.").

## Summary templates

| Tool | Template |
|------|----------|
| `get_actor` (Player) | `"<name> — Level <level> <class>, HP <cur>/<max>, AC <ac>."` |
| `get_actor` (NPC) | `"<name> — HP <cur>/<max>, AC <ac>, move <move>."` |
| `use_item` (weapon) | `"<weapon>: <total> to hit, <damage> damage."` |
| `use_item` (spell, success) | `"<spell> cast successfully."` |
| `use_item` (spell, failure) | `"<spell> failed and is lost for the day."` |
| `use_item` (spell, fumble) | `"<spell> miscast — lost permanently."` |
| `use_item` (torch lit) | `"<item> lit. About <minutes> minutes of light."` |
| `use_item` (torch extinguished) | `"<item> extinguished."` |
| `roll` (ability check / save) | `"<ability> check: <total>."` |
| `roll` (attack) | `"<weapon>: <total> to hit."` |

Crit and fumble add one word ("Crit." / "Fumble.") to the front of the relevant summaries.
