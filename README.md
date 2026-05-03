# Foundry Voice Control

A Foundry VTT v14 module that exposes an MCP-style HTTP API so a voice client (Claude Desktop, Claude in Chrome, the Claude SDK, or any MCP client) can drive your game at the table — change scenes, manage NPCs, control tokens, modify stats and portraits, and use items or roll skills, all from voice.

> **Status:** v0.1.0 — first releasable build. Three game systems supported (D&D 5e, Shadowdark RPG, Warhammer: The Old World). Targets Foundry v14. The module's Foundry-version-specific integration points are marked **VERIFY** in the source — work them in your dev install per `docs/install.md`.

## Install

In Foundry's Setup screen:

1. **Add-on Modules → Install Module**.
2. Paste this manifest URL into the **Manifest URL** field at the bottom:

   ```
   https://github.com/<your-username>/foundry-voice-control/releases/latest/download/module.json
   ```

3. Click **Install**.
4. Open your world. **Settings → Manage Modules** → tick **Foundry Voice Control** → **Save Module Settings**.
5. Restart Foundry once (the module's server-side code only loads at process start).
6. In any chat input as GM:

   ```
   /voice key new "operator" --scopes=operator
   ```

   Copy the `fvc_…` value (shown once) into your MCP client's auth header.

For full install + smoke-test directions, see **[docs/install.md](docs/install.md)** and **[docs/quickstart.md](docs/quickstart.md)**.

## What it does

The module installs in a Foundry world and registers an HTTPS API at:

```
POST /modules/foundry-voice-control/api/<tool>
Authorization: Bearer fvc_…
```

Every call returns a JSON envelope with both a structured `data` payload (for the agent) and a one-sentence `summary` (for voice). The current tool surface (v1) covers:

- **Scene** — `activate_scene`, `list_scenes`, `get_active_scene`
- **Token** — `select_tokens`, `deselect_tokens`, `target_tokens`, `untarget_tokens`, `place_token`, `set_token_image`
- **Actor** — `create_actor`, `update_actor`, `get_actor`, `find_actor`, `set_actor_image`, `delete_actor`
- **Item** — `list_items`, `add_item`, `remove_item`, `update_item`
- **System-gated** — `use_item`, `roll` (per-system implementations for D&D 5e, Shadowdark, WH:TOW)
- **Perception** — `describe_scene`, `get_scene_state`, `get_world_state`
- **Lifecycle** — `undo`

Plus an in-Foundry chat-command surface (`/voice key new`, `/voice audit show`, `/voice revoke-all`, etc.) for managing keys without leaving the world.

## How it's built

Two halves under one `module.json`:

- **Server-side** (Node, runs in the Foundry process) — owns the public HTTPS API, authenticates Claude with hashed scoped API keys, runs the audit log, dispatches canvas/UI work to the GM client over Foundry's socket layer.
- **Client-side** (browser, runs in every connected user's tab) — the GM's tab services dispatched ops (token selection, rolls, item use) and replies on the socket.

Voice-first throughout: every tool returns a one-sentence summary suitable for reading aloud, the resolver fuzzy-matches actor and scene names from voice transcription, deletions require confirm-after-dry-run, and player-authored prose in the world (bios, journal entries) is wrapped with an `untrusted: true` marker so the agent treats it as data, not instructions.

Full design docs:

- [`docs/architecture.md`](docs/architecture.md) — server/client split, transport, scope.
- [`docs/api-contract.md`](docs/api-contract.md) — tool surface, response envelope, error codes, scopes.
- [`docs/safety-and-permissions.md`](docs/safety-and-permissions.md) — auth, undo, input validation, audit, rate limits.
- [`docs/voice-design.md`](docs/voice-design.md) — voice response patterns, fuzzy match handling, untrusted content rules.
- [`docs/testing-strategy.md`](docs/testing-strategy.md) — unit / integration / voice-script test layers.
- [`references/`](references/) — Foundry v14 API reference (system-agnostic) plus per-system specs for the three supported systems.

## Supported game systems

| System | `game.system.id` | Notes |
|--------|------------------|-------|
| **D&D 5e** | `dnd5e` | dnd5e v3.x / v4.x. Strict validation on the documented schema; rejects writes to computed paths (mod, total, prof, etc.). |
| **Shadowdark RPG** | `shadowdark` | Categorical movement enforced. Spell-loss flow on failure / fumble. Light-source toggle. |
| **Warhammer: The Old World** | (verify at install — likely `whtow` / `wh-old-world`) | Implements the d10 pool mechanic from rules text since the system's Foundry implementation is young. Grim/Glorious modifiers, side-based combat. |

Adding a system is a matter of dropping in a `validators` half on the server and an `executors` half on the client; see `references/systems/_template.md` and the existing handlers for the pattern.

## Security

Default posture is "personal-game safe":

- **Hashed API keys** with five granular scopes (`read`, `scene`, `actor-write`, `roll`, `gm`) plus presets.
- **TLS-required** transport, bearer-only auth, per-key and per-IP rate limits.
- **Audit log** of every tool call (allowlisted metadata only, never parameter values).
- **Stealth-deny** (404 not 401) so unauthenticated scanners can't fingerprint the module.
- **Image-input validation** — path canonicalization, URL allowlist with RFC1918 / metadata-IP block list, SVG rejection, schemeful inputs (`file:`, `javascript:`, etc.) refused.
- **Snapshot-based undo** for every reversible mutation, with a 1-hour TTL and one-shot consumption.
- **Untrusted-content marker** on player-authored prose so the agent treats it as data, not commands.
- **Panic command**: `/voice revoke-all` disables every key in one chat line.

The full threat model and concrete requirements are in `docs/safety-and-permissions.md`.

## Development

```bash
git clone https://github.com/<your-username>/foundry-voice-control.git
cd foundry-voice-control/module
npm install
npm test                  # 205 unit tests
```

For live iteration against a real Foundry instance, symlink `module/` into your `<userData>/Data/modules/foundry-voice-control/` per `docs/install.md`.

To cut a release for end-user installation, see **[docs/publishing.md](docs/publishing.md)**.

## License

[MIT](LICENSE) — do whatever you want with it; no warranty.

## Contributing

This is currently a solo / small-group project. Issues and PRs are welcome but expect best-effort response. If you're adding a new game system handler, the pattern is documented in `references/systems/_template.md` and the existing dnd5e / shadowdark / whtow handlers are the references to copy.
