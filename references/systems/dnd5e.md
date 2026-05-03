# D&D 5e (`dnd5e`)

Per-system reference for the official D&D 5e Foundry system. Used by recipes for system-gated tools (`create_actor` validation, `update_actor` system paths, `add_item` / `update_item` validation, `use_item`, `roll`).

> **Verify on implementation.** The `dnd5e` system evolves between minor releases — paths, helper APIs, and roll method names occasionally change. Treat this doc as the *intended* shape; confirm against `game.system.version` at module init and log a warning on mismatch with the version this doc was written against.

**Doc baseline:** `dnd5e` v3.x / v4.x conventions on Foundry v14.

## Actor schema (key paths)

### Universal (all actor types)

| Path | Type | Notes |
|------|------|-------|
| `name` | string | Actor name |
| `img` | path | Portrait |
| `prototypeToken.texture.src` | path | Default token image |
| `system.attributes.hp.value` | int | Current HP |
| `system.attributes.hp.max` | int | Max HP |
| `system.attributes.hp.temp` | int | Temporary HP |
| `system.attributes.hp.tempmax` | int | Temporary max HP modifier (rare) |
| `system.attributes.ac.flat` | int | NPC: explicit AC. PC: override; usually leave undefined and let it compute. |
| `system.attributes.ac.value` | int | **Computed.** Don't write directly. |
| `system.attributes.movement.walk` | int | Walking speed in feet |
| `system.attributes.movement.fly` | int | Flying speed |
| `system.attributes.movement.swim` | int | Swimming speed |
| `system.attributes.init.bonus` | int | Bonus to initiative |
| `system.attributes.prof` | int | **Computed proficiency bonus** from level/CR. Read-only. |
| `system.abilities.<a>.value` | int | Score 1–30 for `a ∈ {str, dex, con, int, wis, cha}` |
| `system.abilities.<a>.proficient` | 0/0.5/1 | Save proficiency multiplier |
| `system.abilities.<a>.mod` | int | **Computed modifier.** Read-only. |
| `system.skills.<s>.value` | 0/0.5/1/2 | Proficiency multiplier (0 = none, 1 = prof, 2 = expertise) |
| `system.skills.<s>.ability` | string | Default ability for the skill |
| `system.skills.<s>.total` | int | **Computed total.** Read-only. |
| `system.traits.size` | string | `tiny | sm | med | lg | huge | grg` |
| `system.traits.di.value` | array | Damage immunities (string keys) |
| `system.traits.dr.value` | array | Damage resistances |
| `system.traits.dv.value` | array | Damage vulnerabilities |
| `system.traits.languages.value` | array | Known languages |

**Skill keys** (use these exactly):

```
acr  ani  arc  ath  dec  his  ins  itm  inv
med  nat  prc  prf  per  rel  slt  ste  sur
```

(Acrobatics, Animal Handling, Arcana, Athletics, Deception, History, Insight, Intimidation, Investigation, Medicine, Nature, Perception, Performance, Persuasion, Religion, Sleight of Hand, Stealth, Survival.)

### Type-specific

**`character`** (PC):
- `system.details.race` — race id (or use a `race` item, depending on dnd5e version)
- `system.details.background` — text (or `background` item)
- `system.details.alignment` — string
- `system.details.xp.value` / `.max` — XP track
- `system.details.level` — **computed** from class items; do not set directly
- `system.classes.<class>.levels` — set on a `class` item, not here
- `system.spells.spell<n>.value` / `.max` — spell slots, n = 1..9
- `system.spells.pact.value` / `.max` / `.level` — warlock pact slots
- `system.attributes.spelldc` — **computed** from class

**`npc`**:
- `system.details.cr` — challenge rating (numeric, e.g. 0.25, 1, 17)
- `system.details.type.value` — creature type (`humanoid`, `dragon`, etc.)
- `system.details.alignment` — string
- `system.details.source` — sourcebook attribution
- `system.attributes.spellLevel` — caster level for monster spellcasting
- HP often expressed as a roll formula; `value` / `max` are concrete numbers

**`vehicle`** and **`group`** are out of scope for v1.

## Item types

System.documentTypes.Item keys: `weapon, equipment, consumable, tool, loot, class, subclass, spell, feat, background, race, container, facility, tattoo`.

Common `system.*` paths by type:

### `weapon`

| Path | Type | Notes |
|------|------|-------|
| `system.weaponType` | string | `simpleM, martialM, simpleR, martialR, natural` |
| `system.attackBonus` | string | Formula bonus, e.g. `"+1"` or `"@mod + 2"` |
| `system.damage.parts` | array | `[["1d8 + @mod", "slashing"], ...]` |
| `system.damage.versatile` | string | Versatile damage formula |
| `system.actionType` | string | `mwak, rwak, msak, rsak, save, abil, util, heal, other` |
| `system.activation.type` | string | `action, bonus, reaction, free, longRest, shortRest, day, special` |
| `system.range.value` / `.long` | int | Range in feet |
| `system.uses.value` / `.max` / `.per` | mixed | Charges / consumable uses |
| `system.proficient` | 0/0.5/1 | Proficiency override |
| `system.equipped` | bool | |
| `system.properties` | object | Tags like `fin, hvy, lgt, two, ver, mag, ada` (varies by version) |

### `spell`

| Path | Type | Notes |
|------|------|-------|
| `system.level` | int | 0–9 (0 = cantrip) |
| `system.school` | string | `abj, con, div, enc, evo, ill, nec, trs` |
| `system.components.vocal` | bool | |
| `system.components.somatic` | bool | |
| `system.components.material` | bool | |
| `system.components.ritual` | bool | |
| `system.preparation.mode` | string | `prepared, pact, atwill, innate, always` |
| `system.preparation.prepared` | bool | |
| `system.activation` | object | Same as weapon |
| `system.duration` | object | `{ value, units }` |
| `system.range` | object | `{ value, long, units }` |
| `system.target` | object | `{ value, type }` |
| `system.damage.parts` | array | Same shape as weapon |
| `system.save.ability` | string | Save DC ability key |
| `system.save.dc` | int | Override DC |
| `system.scaling` | object | `{ mode, formula }` for upcasting |

### `feat`

| Path | Type | Notes |
|------|------|-------|
| `system.type.value` | string | `class, race, background, monster, feat` |
| `system.activation` | object | Same shape as weapon |
| `system.uses` | object | Same shape as weapon |
| `system.damage` | object | When applicable |

### `consumable` / `equipment` / `tool`

Similar shape; `system.consumableType`, `system.armor.value` (for equipment), `system.proficient` (for tools).

### `class` and `subclass`

| Path | Type | Notes |
|------|------|-------|
| `system.levels` | int | Class level (0 on subclass items) |
| `system.hitDice` | string | `d6 | d8 | d10 | d12` |
| `system.hitDiceUsed` | int | |
| `system.spellcasting.progression` | string | `none, full, half, third, pact, artificer` |
| `system.spellcasting.ability` | string | Casting ability key |

## Roll methods (Actor)

```js
// Skill check — returns Roll, posts chat message
await actor.rollSkill(skillKey, { advantage: false, disadvantage: false, fastForward: true });

// Saving throw
await actor.rollSavingThrow(abilityKey, { advantage, disadvantage, fastForward: true });
// (Older dnd5e versions: actor.rollAbilitySave(abilityKey, options))

// Ability check (raw, not skill)
await actor.rollAbilityCheck(abilityKey, options);
// (Older: actor.rollAbilityTest)

// Initiative
await actor.rollInitiativeDialog();          // with dialog
await actor.rollInitiative({ createCombatants: true });
```

`fastForward: true` skips the dialog and uses defaults — what the module wants for voice flows.

## Roll methods (Item)

```js
// Generic "use this thing" — handles attack, damage, save DC, consumes uses, posts chat
await item.use({ configureDialog: false }, { configureDialog: false });

// Attack roll only
await item.rollAttack({ advantage, disadvantage, fastForward: true });

// Damage roll only (after attack lands)
await item.rollDamage({ critical: false, options });

// Spell-specific: cast at higher level
await item.use({ slotLevel: 3, configureDialog: false });
```

`item.use()` is the right entry point for `use_item` in the contract — it handles the entire system flow (consume slot, roll attack, roll damage, post chat, fire hooks). `rollAttack` / `rollDamage` are for finer-grained control.

## Mapping the `roll` tool's `kind` to dnd5e calls

| `kind` | `target` | dnd5e call |
|--------|----------|------------|
| `skill` | Skill key (e.g. `"per"`) | `actor.rollSkill(target, opts)` |
| `save` | Ability key (e.g. `"dex"`) | `actor.rollSavingThrow(target, opts)` |
| `attack` | Item id_or_name | `actor.items.get(target).rollAttack(opts)` |
| `custom` | Roll formula string | `new Roll(target, actor.getRollData()).roll({async: true})` then post to chat |

`options` maps to dnd5e's flags: `{ advantage: bool, disadvantage: bool, fastForward: true }`. Voice flows pass `fastForward: true` by default — the user verbalizes advantage if they want it.

## Helper APIs

The `dnd5e` system exposes a `game.dnd5e` namespace. Useful members (verify per release):

| Path | Use |
|------|-----|
| `game.dnd5e.documents.Actor5e` | Actor document class |
| `game.dnd5e.documents.Item5e` | Item document class |
| `game.dnd5e.dice.d20Roll` | Programmatic d20 roll with all dnd5e options |
| `game.dnd5e.dice.damageRoll` | Programmatic damage roll |
| `game.dnd5e.config.skills` | Map of skill keys to labels |
| `game.dnd5e.config.abilities` | Map of ability keys to labels |
| `game.dnd5e.config.damageTypes` | Damage type labels |
| `game.dnd5e.config.itemActionTypes` | Action type labels |
| `game.dnd5e.utils.simplifyBonus` | Resolve a roll formula bonus to a numeric value when possible |

`game.dnd5e.config.*` is the right place to look up valid keys for resolver fuzzy matching (skill key from user-spoken skill name, etc.).

## Spellcasting model

PCs:
- Slot count: `system.spells.spell<n>.max` (cantrips don't have slots).
- Slots used: `max - value`. Casting consumes from `value`.
- Pact magic: `system.spells.pact.value/max/level` (warlock).
- Casting at higher level: `item.use({ slotLevel: n })`.

Monsters with spellcasting:
- Spell slots in `system.spells.spell<n>` even on NPCs (when relevant).
- "At will" / "1/day" spells use `spell.system.uses.max/value` and `spell.system.uses.per`.

Cantrips scale via `system.scaling = { mode: "cantrip", formula: "" }` and dnd5e auto-scales by character level / CR.

## Known gotchas

1. **HP from formula on NPCs.** Many monster stat blocks express HP as `"4d8+8"`. The MDB sets `system.attributes.hp.value` to a rolled number; `update_actor` patches should set both `value` and `max`. Don't update `formula` and expect Foundry to re-roll.
2. **AC on NPCs via `flat`.** PCs compute AC; NPCs use `system.attributes.ac.flat`. `update_actor` should write `flat` for NPCs; for PCs, write the underlying armor item or accept that the field won't apply.
3. **Ability `mod` is computed.** Don't try to set `system.abilities.str.mod` directly — write `value` and let the data model derive. If the user says "set strength mod to +3," translate to `value: 16`.
4. **Skill `total` is computed.** Same: write `value` (proficiency multiplier) and `ability` (default ability). Resolver maps "Perception" → `prc`.
5. **Spell slots reset on long rest.** Foundry has a `actor.longRest()` / `shortRest()` API; voice should expose those eventually but they're out of v1 scope.
6. **`item.use()` may open a dialog.** Always pass `{ configureDialog: false }` for voice flows.
7. **Race / background / class as items.** Modern dnd5e treats race, background, and class as item documents on the actor, not stat-block fields. `create_actor` for a PC should normally include these as `items[]`.
8. **Damage parts are tuples in arrays.** `[["1d8 + @mod", "slashing"]]` not `{formula, type}`. Validation must enforce the array shape.
9. **`@mod` and other roll-data references.** Damage formulas use `@mod`, `@prof`, `@abilities.str.mod` etc. The roll-data lookup happens at roll time, not when the spec is created. Validation should sanity-check formulas with `Roll.validate()` if available, but won't catch missing roll-data references.
10. **System version drift.** dnd5e moves fast. The set of valid `actionType` values, the structure of `system.properties`, and the `feat.system.type.value` enum all changed between recent majors. The module should log `system.version` at boot and refuse to validate against an out-of-range version.

## Summary templates (system-specific overrides)

| Tool | Template |
|------|----------|
| `get_actor` (PC) | `"<name> — Level <level> <class>, HP <cur>/<max>, AC <ac>."` |
| `get_actor` (NPC) | `"<name> — CR <cr> <type>, HP <cur>/<max>, AC <ac>."` |
| `use_item` (weapon attack) | `"<weapon>: <total> to hit, <damage_total> <damage_type>."` |
| `use_item` (spell with save) | `"<spell> cast — <save_ability> save DC <dc>."` |
| `use_item` (consumable) | `"Used <item><, <remaining> remaining>."` |
| `roll` (skill) | `"<skill_label>: <total>."` |
| `roll` (save) | `"<ability> save: <total>."` |
| `roll` (attack) | `"<item>: <total> to hit." (then prompt for damage if hit)` |

Critical hits and fumbles add one word ("crit" / "fumble") to the front of the summary; the contract's `data.results` carries the structured detail.
