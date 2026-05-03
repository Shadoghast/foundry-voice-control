# Foundry Voice Control

A Foundry VTT operating layer for voice-first interaction. A Foundry-side MCP module exposes tools that let Claude change scenes, manage NPCs, control tokens, alter stats and portraits, and use items or abilities — all driven by the user's voice.

## Project map

- `docs/install.md` — installation directions for a dev Foundry v14 instance
- `docs/quickstart.md` — smoke-test walkthrough with curl examples per tool
- `docs/publishing.md` — GitHub repo setup + release flow for end-user install
- `docs/architecture.md` — module design, transport, scope, decisions
- `docs/api-contract.md` — MCP tool surface and response shapes
- `docs/voice-design.md` — voice-friendly response patterns and disambiguation
- `docs/safety-and-permissions.md` — auth, allowlist, dry-run, undo
- `docs/testing-strategy.md` — test worlds, fixtures, regression
- `references/core-foundry-api.md` — system-agnostic Foundry API
- `references/recipes.md` — one recipe per supported verb
- `references/systems/` — per-system stat/item/ability references
- `module/` — Foundry-side MCP module source
- `tests/` — automated test fixtures and scripts

## Working rules

1. Read this file first. Then load only the doc(s) needed for the current task.
2. For any operation that touches stats, items, abilities, or rolls, check `game.system.id` and load `references/systems/<id>.md` before writing tool definitions or recipes.
3. Voice is the primary interface. Every action tool must return a one-sentence human summary alongside structured data — see `docs/voice-design.md`.
4. State-changing operations follow the safety patterns in `docs/safety-and-permissions.md`.
