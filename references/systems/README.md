# System References

Index of per-system reference files. One file per `game.system.id` we support. New systems are added by copying `_template.md` and filling each section.

## Currently supported

| System | File | `game.system.id` | Notes |
|--------|------|------------------|-------|
| D&D 5e | `dnd5e.md` | `dnd5e` | Mature system; baseline for the per-system schema. |
| Shadowdark RPG | `shadowdark.md` | `shadowdark` | OSR-style; categorical movement; light tracking. |
| Warhammer: The Old World RPG | `whtow.md` | **VERIFY at install** (likely `whtow` / `wh-old-world` / `the-old-world`) | d10 pool, side-based init, Resilience + Wounds. |

## How a system handler is loaded

At module init, the WH:TOW handler — and likewise the dnd5e and shadowdark handlers — registers with a system registry keyed by `game.system.id`. System-gated tools (`use_item`, `roll`, system-aware validation in `create_actor` / `add_item` / `update_*`) consult the registry; if no handler is present for the active system, the response is `system_unsupported` per the API contract.

Each handler implements the same internal interface:

```
SystemHandler {
  validateActorSpec(spec) → { ok, errors }
  validateItemSpec(spec) → { ok, errors }
  validateUpdatePath(path) → { ok, error? }
  useItem(actor, item, options) → { rolls, chat_message_id, summary }
  roll(actor, kind, target, options) → { formula, total, results, chat_message_id, summary }
  composeActorSummary(actor) → string   // overrides the universal template
}
```

The exact signatures are defined in `module/` source once implementation begins.
