# Warhammer: The Old World RPG (Cubicle 7, 2025)

Per-system reference for the Cubicle 7 *Warhammer: The Old World Roleplaying Game*. This game launched in 2025 and is a separate system from WFRP 4e — the dice mechanic and data model are not compatible.

> **Heavy verification required.** I am writing this with high confidence on the *game mechanics* (sourced from the warhammer skill / Player's Guide and Gamemaster's Guide) and **lower confidence on the Foundry system data model**, because the WH:TOW Foundry implementation is young and may be community-built or in flux.
>
> **System id check.** Confirm `game.system.id` at module init. Likely candidates: `wh-old-world`, `whtow`, `the-old-world`, or `warhammer-the-old-world`. Reject the module's WH:TOW handler if `game.system.id` doesn't match the configured value.
>
> **Do not assume WFRP 4e compatibility.** WH:TOW uses **d10 dice pools** counting successes against a skill rating. WFRP 4e uses d100 percentile. The data model will differ substantially. Don't carry over `wfrp4e` paths.

**Doc baseline:** WH:TOW Player's Guide and Gamemaster's Guide (Cubicle 7, 2025). Foundry system version pending.

## Mechanics in one paragraph

Tests roll a pool of d10s equal to the relevant **Characteristic** (rating 2–6), counting each die showing ≤ the relevant **Skill rating** (rating 2–6) as a **success**. One success suffices; more = better outcome. Pool can be modified by **+1d / –1d** (capped at 2× Characteristic), and if the pool drops below 1d, you still roll 1d10 but it succeeds only on a **1**. Outcomes ladder: 0 = Failure, 1 = Marginal Success (with possible Complication), 2 = Success, 3+ = Total Success. Two test-modifier flavors: **Grim** (must reroll all successes — bad circumstances) and **Glorious** (may reroll all failures — divine favor / magical boon); they cancel each other and don't stack. Combat uses **side-based initiative** (players' side first as a group, then GM's), positions are tracked in **Zones** rather than feet, and damage that exceeds **Resilience** (Toughness + Armour) inflicts a **Wound** rolled on the Wounds Table; damage at-or-below Resilience inflicts the **Staggered** condition (and a second Stagger upgrades to a Wound).

## The eight Characteristics and their sixteen Skills

| Characteristic | Skills |
|----------------|--------|
| Weapon Skill (WS) | Melee, Defence |
| Ballistic Skill (BS) | Shooting, Throwing |
| Strength (S) | Brawn, Toil |
| Toughness (T) | Survival, Endurance |
| Initiative (I) | Awareness, Dexterity |
| Agility (Ag) | Athletics, Stealth |
| Reason (Re) | Willpower, Recall |
| Fellowship (Fel) | Leadership, Charm |

Skills always pair with their parent Characteristic. The voice resolver should accept either "Re:Willpower" or "Willpower" (skill-only is unambiguous since each skill maps to exactly one Characteristic).

## Actor types

| Type | Use |
|------|-----|
| `character` | PCs (Origin + Career) — **VERIFY** subtype string |
| `npc` | NPCs and creatures — **VERIFY** |
| `creature` | Possibly separate from `npc` for monsters / beasts — **VERIFY** if this exists |

Confirm exact strings against `game.system.documentTypes.Actor`. Reject `create_actor` for unregistered types.

## Actor schema — expected shape

> Structure below describes the *expected shape*. **Every dot-path is VERIFY territory** until validated against the live system. Reasoning is given so drift can be located fast.

### Universal

| Path (expected) | Type | Notes |
|------|------|-------|
| `name` | string | |
| `img` | path | |
| `prototypeToken.texture.src` | path | |
| `system.characteristics.ws.value` | int | Weapon Skill rating, 2–6 |
| `system.characteristics.bs.value` | int | Ballistic Skill |
| `system.characteristics.s.value` | int | Strength |
| `system.characteristics.t.value` | int | Toughness |
| `system.characteristics.i.value` | int | Initiative |
| `system.characteristics.ag.value` | int | Agility |
| `system.characteristics.re.value` | int | Reason |
| `system.characteristics.fel.value` | int | Fellowship |
| `system.skills.<key>.rating` | int | Skill rating 2–6; `key` = lowercase skill name |
| `system.skills.<key>.ticks` | int | Endeavour ticks toward next rating |
| `system.resilience.value` | int | Toughness + Armour bonus — usually computed |
| `system.wounds.value` / `.max` | int | Current / max Wounds |
| `system.fate.value` / `.max` | int | Fate Points (PC-specific; NPCs typically lack Fate) |
| `system.conditions` | array | Active conditions — `["staggered", "broken", "ablaze", ...]` |
| `system.armour.value` | int | Armour bonus contributing to Resilience |
| `system.encumbrance.value` / `.max` | int | Carrying capacity |

**Skill keys** (lowercase, hyphenated where two words):

```
melee  defence  shooting  throwing  brawn  toil
survival  endurance  awareness  dexterity  athletics  stealth
willpower  recall  leadership  charm
```

### `character`-only (PCs)

| Path | Type | Notes |
|------|------|-------|
| `system.origin` | string \| object | Empire Human, Bretonnian, Dwarf, etc. — may be a string ref or an embedded item |
| `system.career` | string \| object | Current career — may be string or item |
| `system.status.tier` | string | `brass | silver | gold` |
| `system.status.coin` | int | Current Coin (3 default, refilled each Downtime) |
| `system.xp.current` | int | Unspent XP |
| `system.xp.spent` | int | Total spent — useful for character history |
| `system.contacts` | array | Contacts list — references to NPC actors or text |
| `system.grimPortent` | string \| object | The character's Grim Portent (a personal hook) |
| `system.lores` | array | Known Lores (Academic, Cultural, Enemy, Magic, Trade, Environment) |
| `system.talents` | array | Known Talents (also typically items — **VERIFY**) |

### `npc`-only

| Path | Type | Notes |
|------|------|-------|
| `system.threat` | string | `minion | regular | elite | nemesis` (or system-specific) — **VERIFY** taxonomy |
| `system.morale` | int | Where applicable |
| `system.flavor` | string | Stat-block prose |
| `system.special` | array | Special abilities (often as items) |

## Item types — expected

Likely set: `weapon, armour, gear, talent, spell, prayer, blessing, lore, career, origin, contact, condition, equipment-pack`. Confirm against `game.system.documentTypes.Item`.

### `weapon`

| Path | Notes |
|------|-------|
| `system.weaponType` | `melee | ranged | thrown` |
| `system.skill` | `melee | shooting | throwing | brawn` |
| `system.damage` | int — flat damage rating, added to Successes per the rules |
| `system.range` | string — Zone range band where applicable (`close | short | medium | long | extreme`) |
| `system.qualities` | array — `["sharp", "two-handed", "thrown", "polearm", ...]` |
| `system.equipped` | bool |

### `armour`

| Path | Notes |
|------|-------|
| `system.armourBonus` | int — contributes to Resilience |
| `system.qualities` | array — `["heavy", "noisy", ...]` |
| `system.equipped` | bool |

### `spell`

| Path | Notes |
|------|-------|
| `system.lore` | string — `battle | elementalism | illusionism | necromancy | improvised` |
| `system.tier` | int — spell tier where applicable |
| `system.castingTest` | object — `{ characteristic, skill, threshold? }` |
| `system.range` | string — Zone band |
| `system.duration` | string |
| `system.effects` | string \| array |

### `prayer` / `blessing`

| Path | Notes |
|------|-------|
| `system.deity` | string — `sigmar | ulric | taal | morr | shallya | ...` |
| `system.test` | object — `{ characteristic, skill }` (typically Re:Willpower) |
| `system.effect` | string |

### `talent`

| Path | Notes |
|------|-------|
| `system.cost` | int — XP cost (2–4 typically) |
| `system.tier` | int \| string — talent tier |
| `system.effect` | string |
| `system.prerequisites` | array |

### Other types

`career`, `origin`, `lore`, `contact` are typically reference-data items providing structured text. `condition` items represent active status effects when the system uses items rather than a `system.conditions` array.

## Roll mechanics in module terms

Independent of the Foundry system's exact API — this is what the module needs to do regardless:

```
test(characteristic, skill, modifiers, options) {
  pool = clamp(characteristic + modifiers, 1, 2 * characteristic)
  threshold = skill
  rolled  = pool d10s
  successes = count(d <= threshold for d in rolled)
  if pool < 1: successes = 1 if d == 1 else 0   // sub-1 pool special
  if grim:    rerolled successes; recompute
  if glorious: rerolled failures; recompute
  outcome = "fail" | "marginal" | "success" | "total" based on count
  return { rolled, successes, outcome, complication: outcome == "marginal" }
}
```

The Foundry system's roll method should produce a Roll/ChatMessage doing the above. **VERIFY** the exact method name (likely `actor.rollTest(charKey, skillKey, options)` or similar). If it doesn't exist, the module's WH:TOW handler may need to do the d10 pool roll itself and post a chat message.

## Mapping the `roll` tool's `kind` to WH:TOW

| `kind` | `target` | WH:TOW call |
|--------|----------|--------------|
| `skill` | `"<charKey>:<skillKey>"` (e.g. `"re:willpower"`) or `"<skillKey>"` if unambiguous | `actor.rollTest(charKey, skillKey, opts)` (**VERIFY** name) |
| `save` | Same as skill — WH:TOW has no separate save concept; resistance / opposed tests use Skills | Same call as `skill`. The module composes "vs. Y" into the chat message based on `opts.opposed` info. |
| `attack` | Item id_or_name | `weaponItem.rollAttack(opts)` or equivalent — needs to compute the right Char+Skill from `weapon.system.skill` |
| `custom` | Raw test spec `{ characteristic, threshold, modifiers? }` | Module-level d10 pool roll, posted to chat. |

`options` typically includes:
- `bonusDice: int` — `+N` to pool (clamped at 2× Char)
- `penaltyDice: int` — `-N` to pool
- `grim: bool`
- `glorious: bool`
- `fastForward: true` for voice flows
- `opposed: { actor, characteristic, skill }` — optional, for opposed tests

Voice phrasing: the user usually says either "WS Melee test" or "Melee test" or "test Melee." The resolver maps "Melee" → `(ws, melee)` unambiguously.

## Combat specifics

### Side-based initiative

WH:TOW's combat order is the players' side as a group, then the GM's side. The Initiative Characteristic is for Awareness / Dexterity skills, not turn order. This affects how `target_tokens` flows during combat — there's no per-token initiative score driving who acts when. The module shouldn't try to set per-token initiative for WH:TOW.

The `get_world_state` and `get_scene_state` tools should expose `combat: { side: "players" | "gm" | "none", round: <n> }` rather than an initiative list when the active system is WH:TOW.

### Resilience and Wounds

Damage flow:

1. Successes on attack determine **damage rating** (weapon's flat damage + extra from Total Successes — exact formula per Player's Guide).
2. Compare to defender's **Resilience** (`Toughness + Armour`).
3. If `damage <= resilience`, defender gains **Staggered**. If already Staggered, upgrade to a Wound.
4. If `damage > resilience`, defender suffers a Wound. Roll on the Wounds Table for severity (Light / Heavy / Critical).
5. Track via `system.wounds.value++` plus the wound severity record.

`update_actor` on damage should:
- Read current Resilience.
- Apply Staggered or increment Wounds based on the comparison.
- Surface the Wound severity in the response if a Wound was inflicted.

### Conditions

| Condition | Mechanical effect |
|-----------|-------------------|
| Staggered | –1d on all Tests until removed |
| Broken | Must flee or cower; –2d on all Tests |
| Burdened | –1d on physical Tests |
| Drained | –1d |
| Distracted | –1d |
| Ablaze | Hazard (fire damage) each turn |
| Prone | –1d |
| Blinded | Severe penalties (varies) |

`update_actor` patches that touch `system.conditions` should validate against the canonical list and reject typos. Voice readbacks lead with the condition name: `"<Name> is now Staggered."`

### Charge / Retreat

Charge is moving into an enemy's Zone and immediately attacking; many weapons gain bonuses on Charge. Retreat from melee usually requires spending Fate. Both are gameplay-level concerns the module surfaces via the `use_item` flow on weapons (with a `charge: true` option) and a future `spend_fate` tool (not in v1; tracked in deferred scope).

## Fate

`system.fate.value` / `.max`. Fate resets each session, so a session-start hook should reset all PC `system.fate.value = system.fate.max`.

Three uses:
- **Spend (refunded at session end)**: make a Test Glorious; take a second different action; act as rearguard.
- **Burn (permanent –1)**: succeed a Test outright; negate a Wound just suffered; heroic last stand.

The module should never silently burn Fate. Burning is destructive enough that voice flows must explicitly confirm — same dry-run-first treatment as deletion. (Track in voice-design.md as a system-specific destructive trigger.)

## Magic

Lores: **Battle Magic, Elementalism, Illusionism, Necromancy**, plus **improvised spells**. Each lore has its own catalog of spells. Casting is a Test (typically against a relevant Characteristic + skill, with the spell's tier as a modifier). Botched casts can trigger miscasts; miscast severity is tabled. **VERIFY** how the system surfaces miscasts (chat hook? auto-update?) — the module's `use_item` for spells must propagate this into the response summary.

Voice templates for spell casting outcomes:

| Outcome | Summary |
|---------|---------|
| Total Success | `"<spell> cast — total success."` |
| Success | `"<spell> cast successfully."` |
| Marginal Success | `"<spell> cast with a complication."` |
| Failure | `"<spell> failed."` |
| Miscast | `"<spell> miscast — <severity>."` |

For deeper magic detail, load `references/magic.md` from the warhammer skill before authoring the magic-related parts of the module's spell handler.

## Religion (prayers / blessings)

Prayers are devotional asks of a deity (Sigmar, Ulric, Taal, Morr, Shallya, etc.); blessings are ad-hoc divine favors. Mechanically, both resolve as Tests (typically Re:Willpower or a deity-specific variant). The deity-specific catalog lives outside this module's concern; the system's `prayer` / `blessing` items contain the test spec and effect.

Voice readback for prayers leads with the deity: `"Prayer to Shallya: succeeds. <effect>."`

## Status and economy

Status tiers are abstract: Brass (poor), Silver (merchant class), Gold (nobility). Each character starts each adventure with **3 Coin of their tier**. Purchases at your tier cost 1 Coin; lower-tier costs are trivial / free; higher-tier costs require either Status increase or barter (Charm vs. Willpower).

Coin resets to 3 at each Downtime. Excess Coin is lost; deficits accrue as work owed.

The module is unlikely to surface fine-grained economy in v1, but `update_actor` on `system.status.coin` and `system.status.tier` should be supported for narrative changes.

## Helper APIs (expected)

The system likely exposes a `game.<systemNamespace>` namespace. **VERIFY** all:

| Path (expected) | Use |
|------|-----|
| `game.<sys>.config` | Config maps for characteristics, skills, conditions, lores, deities |
| `game.<sys>.config.skills` | Skill keys → labels and parent Char |
| `game.<sys>.config.conditions` | Canonical condition list |
| `game.<sys>.config.lores` | Magic lore list |
| `game.<sys>.dice.testRoll` (or similar) | Programmatic d10-pool test |

`game.<sys>.config.skills` is the source of truth for skill-key fuzzy resolution.

## Known gotchas

1. **Pool below 1 still rolls.** The "1d10 succeeds only on a 1" rule is easy to forget. The module's d10-pool helper must implement it.
2. **Side-based initiative breaks initiative-list assumptions.** Don't expose per-token initiative for WH:TOW. `get_scene_state` should report side and round, not an initiative order.
3. **Skill ticks vs. rating.** Skill *rating* is the success threshold (2–6). Skill *ticks* are the Endeavour-failure counters that accumulate toward a rating bump. Don't conflate them — `update_actor` writes to one or the other depending on the user's intent.
4. **Wound severity is rolled, not deterministic.** A Wound triggers a Wounds Table roll — Light / Heavy / Critical. The damage flow can't just decrement HP; it must capture wound severity.
5. **Fate burn is permanent.** Treat as destructive in voice flows. Reset of `value` to `max` happens session-start; resetting `max` is a permanent gain or loss that should require explicit confirmation.
6. **Grim and Glorious cancel.** Don't apply both — collapse to neither before rolling.
7. **WS for Melee AND Defence.** Same Characteristic powers attack and defense in melee. Voice resolver shouldn't assume "defence" implies a different Characteristic.
8. **Old World spelling.** Defence (not Defense), Armour (not Armor), Manoeuvre (not Maneuver). The system likely uses Old World spellings as canonical keys; American spelling fuzzy-matches the user's voice.
9. **Origin/Career as items vs strings.** **VERIFY** which the system uses — affects `create_actor` payload shape and `update_actor` for changes.
10. **Lores aren't damage types.** Lores describe magic traditions and knowledge domains. Don't conflate with "fire damage" or similar — damage types are weapon qualities.
11. **Status and Coin are abstract.** Don't try to track exact gold pieces. The system's economy is intentionally fuzzy.

## Summary templates

| Tool | Template |
|------|----------|
| `get_actor` (PC) | `"<name> — <origin> <career>, Wounds <cur>/<max>, Resilience <r>, Fate <fate.cur>/<fate.max>."` |
| `get_actor` (NPC) | `"<name> — Wounds <cur>/<max>, Resilience <r><, Threat <threat>>."` |
| `roll` (skill / save) | `"<Char>:<Skill> test — <outcome> (<n> successes)."` |
| `use_item` (weapon, hit) | `"<weapon>: <successes> successes vs. defence — <hit | wound | stagger>."` |
| `use_item` (weapon, miss) | `"<weapon>: missed."` |
| `use_item` (spell, success) | `"<spell> cast successfully."` |
| `use_item` (spell, marginal) | `"<spell> cast with a complication."` |
| `use_item` (spell, fail) | `"<spell> failed."` |
| `use_item` (spell, miscast) | `"<spell> miscast — <severity>."` |
| `use_item` (prayer) | `"Prayer to <deity>: <outcome>."` |

Outcomes (`marginal`, `success`, `total`, `fail`) are spoken explicitly because they map to mechanical consequences (Complication on Marginal, additional benefit on Total). Don't compress to "succeed / fail."
