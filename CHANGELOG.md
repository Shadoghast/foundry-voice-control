# Changelog

All notable changes to Foundry Voice Control. Following [semver](https://semver.org/) and [Keep a Changelog](https://keepachangelog.com/) loosely.

## [0.1.0] — 2026-05-02

First releasable build. Voice-controlled operation of Foundry VTT v14 via an HTTP+socket MCP module.

### Added

**Tool surface (v1):**
- Scene tools — `activate_scene`, `list_scenes`, `get_active_scene`.
- Token tools — `select_tokens`, `deselect_tokens`, `target_tokens`, `untarget_tokens`, `place_token`, `set_token_image`.
- Actor tools — `create_actor`, `update_actor`, `get_actor`, `find_actor`, `set_actor_image`, `delete_actor`.
- Item tools — `list_items`, `add_item`, `remove_item`, `update_item`.
- System-gated tools — `use_item`, `roll`. Per-system implementations for **D&D 5e** (`dnd5e`), **Shadowdark RPG** (`shadowdark`), and **Warhammer: The Old World** (`whtow`).
- Perception tools — `describe_scene`, `get_scene_state`, `get_world_state`.
- Lifecycle — `undo` with snapshot-based reversal of every reversible mutation.

**In-Foundry chat commands:** `/voice key new`, `/voice key list`, `/voice key revoke`, `/voice key rotate`, `/voice revoke-all` (panic), `/voice audit show`, `/voice status`, `/voice help`.

**Security:**
- Scoped API keys (`read`, `scene`, `actor-write`, `roll`, `gm`) with three presets and per-key metadata (created/last-used/expires/revoked timestamps).
- Bearer-only HTTPS auth, hashed key storage outside `settings.db`, TLS-required transport (loopback exempt).
- 404-on-unauthenticated stealth-deny so scanners can't fingerprint the module.
- Per-key minute-window rate limits (request / mutation / destructive) plus per-source-IP failed-auth backoff.
- Audit log with allowlisted metadata fields only, 7-day rolling retention.
- Image input validation: path canonicalization under `<userData>/Data/`, URL allowlist with RFC1918 / cloud-metadata block list, SVG rejection, schemeful inputs (`file:` / `javascript:` / `data:`) refused.
- Snapshot-based undo with 1-hour TTL, 50-snapshot/key cap, one-shot consumption, restored documents preserve original `_id` so external references survive.
- Untrusted-content marker on player- and GM-authored prose returned by perception tools so an agent treats them as data, not instructions.
- Voice-flow protections: dry-run-first `delete_actor` requiring explicit `confirm: true`, fuzzy-match warning surfaced to voice on resolver moderate matches, two-failures-in-a-row stop pattern.

**Per-system handlers:**
- D&D 5e: validates against the documented schema (six abilities × 1–30, eighteen SRD skill keys × 0/0.5/1/2 prof multipliers, six size keys, 14 item types, 7 weapon types, 11 action types, 16 damage types). Explicitly rejects writes to **computed paths** (`mod`, `total`, `prof`, `ac.value`, `details.level`) with hints pointing at the underlying writable values. Drives rolls through `actor.rollSkill` / `actor.rollSavingThrow` / `item.use` / `item.rollAttack` / `item.rollDamage`. Spell upcasting via `options.slot_level`.
- Shadowdark RPG: enforces categorical movement (close/near/far), spell-tier 1–5, ability range 3–18, level 1–10, alignment enum. Implements the **spell-loss flow** with three outcomes (success / lost-for-day / lost-permanently-on-fumble). Light-source toggle through the system's tracker if available, manual-flag fallback otherwise. Luck Tokens map to advantage in v1.
- Warhammer: The Old World: implements the **d10 dice pool mechanic** from rules text including the sub-1 pool special case, Grim/Glorious modifiers (canceling), and the four-tier outcome ladder (Failure / Marginal / Success / Total). Side-based combat, Resilience + Wounds tracking, eight Characteristics × sixteen Skills.

**Infrastructure:**
- Server-to-client socket dispatch with request-id correlation, configurable timeout (5 s default), GM-presence check at dispatch time.
- Server-side admin RPC layer for chat-command operations, with payload-vs-socket-authenticated user spoofing protection.
- 205-test Vitest suite covering auth, scope, rate limiter, input validation, envelope builder, log redaction, audit log, resolver, undo store, GM presence, admin handler, and per-system validators.

### Known limitations

- Five Foundry-version-specific integration points marked **VERIFY** in the source. They cover the route registration mechanism, socket.io export, user data path, server-side `serverEsmodules` field, and socket room-name format. Each has a diagnostic table in `docs/install.md` Step 4 to identify which is wrong from the boot logs.
- The dispatcher requires a connected GM client for canvas/UI/roll operations. Server-only data ops work without one.
- WH:TOW Foundry system implementation is young — the per-system handler validates structurally but is permissive on specific paths until the system stabilizes.
- Luck Tokens, Fate burn, and similar system-specific mechanics that need explicit consume-and-confirm flows are simplified in v1; richer handling is on the v1.x backlog.

### Documentation

- `docs/install.md` — installation directions for a dev Foundry v14 instance.
- `docs/quickstart.md` — smoke-test walkthrough with curl examples for every tool.
- `docs/publishing.md` — GitHub release flow for end-user install.
- `docs/architecture.md` / `docs/api-contract.md` / `docs/safety-and-permissions.md` / `docs/voice-design.md` / `docs/testing-strategy.md` — full design docs.
- `references/` — Foundry v14 API reference plus per-system specs.
