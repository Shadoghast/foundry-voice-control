# Architecture

## Goal

Give Claude a small, stable, voice-friendly surface for operating a live Foundry VTT world — change scenes, manage NPCs, control tokens, alter stats and portraits, use items and abilities — by installing a Foundry-side module that exposes those operations as MCP tools.

## Targets

- **Foundry version:** v14 (current stable). API references and module manifest assume v14.
- **Hosting:** internet-reachable Foundry server. The GM client is in Chrome.
- **Game systems (initial):** D&D 5e (`dnd5e`), Shadowdark RPG (`shadowdark`), Warhammer: The Old World (Cubicle 7).
- **Primary interface:** voice. Every action tool returns a one-sentence human summary alongside structured data.

## Big picture

```
   Claude  ──HTTPS──►  Foundry server (Node)  ──socket──►  GM Chrome client
   (MCP)               └ foundry-voice-control module             └ foundry-voice-control module
                          server-side handler                  client-side executor
```

The module ships in two halves that share a `module.json`:

- **Server-side handler** (Node, runs in the Foundry process). Owns the public HTTP/MCP surface, authenticates Claude, and dispatches each tool call to either (a) the server directly for data-only operations, or (b) the connected GM client via Foundry's existing socket layer for anything that needs the canvas, UI, or live game state.
- **Client-side executor** (browser, runs in the GM's Chrome tab). Listens on a private socket channel for dispatched operations, runs them against `game.*` / `canvas.*`, and returns structured results plus a human summary back through the socket.

This split is forced by Foundry: server-side code can mutate the world database freely, but anything that touches the canvas, controlled/targeted tokens, sheet UI, or live rolls only exists in a connected client. A GM client must be open in Chrome for the full tool set to work.

## Why through-Foundry instead of a separate port

Foundry's Node server is already internet-reachable for the user's GM session. Riding on the same web server gives us:

- One URL, one TLS cert, one firewall rule.
- Foundry's existing reverse-proxy / Forge hosting setup just works.
- Auth is independent of Foundry's own login (we use a module-issued API key) so Claude doesn't need to impersonate a user account.
- No ngrok / Cloudflare tunnel required if Foundry is already public.

The module registers routes under `/modules/foundry-voice-control/api/*` via Foundry's `routes` lifecycle. If the user's Foundry is *not* publicly reachable, we document a tunnel as the workaround — we don't try to invent our own.

## Transport

- **Claude → server:** HTTPS, JSON request/response, one route per MCP tool. Streaming is unnecessary; tool calls are short.
- **Server → GM client:** Foundry's built-in `game.socket` namespace, scoped to `module.foundry-voice-control`. The server emits a typed envelope (`{ requestId, tool, params }`); the client replies with `{ requestId, ok, result, summary, error? }`. Server holds a Promise keyed by `requestId` and resolves it on reply.
- **Timeouts:** 5 s default per dispatched op, configurable. On timeout the server returns a structured error to Claude — never a hung tool call.

We deliberately avoid exposing a separate WebSocket to Claude. HTTP is enough; voice turns are short and a single request/response is the simplest thing that works.

## Authentication

Two layers, with full requirements in `docs/safety-and-permissions.md`:

1. **Scoped API keys.** Multiple keys, each with one or more scopes (`read`, `scene`, `actor-write`, `roll`, `gm`). Stored Argon2id-hashed in a server-only file outside Foundry's `settings.db`. Sent on every request as `Authorization: Bearer <key>` over TLS only. Issued, rotated, and revoked via `/voice key …` chat commands; a `/voice revoke-all` panic command exists.
2. **GM presence check.** Before dispatching a client-required tool, the server verifies a GM is connected. Server-only ops run regardless; client-required ops return `gm_unavailable` with an actionable message.

No OAuth, no per-user accounts. The "operator" preset (`read+scene+actor-write+roll`) is the recommended default; `gm` is reserved for explicitly destructive work. See the safety doc for the full requirement set: hashing, transport, rate limits, audit log, input validation, undo, and lifecycle hygiene.

## Module surface boundary

What's a tool vs. internal:

- **Tools (Claude-callable):** the verbs in scope — scene, token, actor, item, ability operations — plus perception tools (`describe_scene`, `get_scene_state`). Defined in `docs/api-contract.md`.
- **Internal (not exposed):** anything that isn't a clear voice verb. World settings, system installs, user management, combat tracker structural changes — all out of scope for v1. We can grow into them, but not by accident.

If a tool can't be implemented safely against all three target systems, it lives behind a per-system gate (e.g., `roll_attack` may behave differently per system). The contract doc enumerates which tools are universal vs. system-gated.

## State and lifecycle

- **Module init.** On Foundry server boot, register routes and the socket handler. On first GM client connect, the client-side executor announces itself; server caches the GM client's userId for dispatch.
- **GM disconnect.** Server marks dispatch unavailable; client-required tools return the "no GM connected" error.
- **Multiple GMs.** If more than one GM is connected, dispatch goes to the first registered. (Open question — see below.)
- **Crash recovery.** All tools are idempotent where possible. Dispatch envelopes include `requestId`; the client de-dupes if a request is replayed. No persistent queue in v1 — if the GM disconnects mid-op, the op fails fast.

## Scope: in for v1

- Activate scene by name or id.
- Create NPC actor (system-aware) from a structured spec.
- Update actor stats/abilities.
- Set actor or token portrait.
- Place a token from an actor onto the active scene.
- Select / deselect tokens; target / untarget tokens.
- Use an item on an actor's sheet (system-specific behavior, gated).
- Roll a skill / ability (system-specific, gated).
- Perception: `describe_scene`, `get_scene_state`, `get_actor`, `find_actor` (fuzzy).

## Scope: deferred

- Combat tracker manipulation beyond targeting.
- Compendium import/export beyond a simple "create from compendium entry" path.
- Playlist / audio control.
- Journal authoring.
- Module installs, system installs, world settings.

## Decisions to confirm

These were inferred from your stage-2 answers; flag any you want to change before I move to `api-contract.md`.

1. **Through-Foundry hosting.** Module registers routes on Foundry's own web server rather than opening its own port. Confirms that your Foundry is reachable on a stable URL.
2. **GM-client requirement.** A GM must be connected in Chrome for any canvas/UI/roll operation. Pure data ops (creating an actor in the directory, editing stats) work even with no GM connected. Acceptable trade or do you want a headless mode that fakes a client?
3. **Multi-GM behavior.** First registered GM wins for dispatch. Alternatives: round-robin, named GM in settings, or fail-if-ambiguous.
4. **Scoped API keys as auth.** Multiple keys, each with one or more scopes; Argon2id-hashed in a server-only file. See `docs/safety-and-permissions.md` for the full requirements.
5. **System gating.** Tools that don't translate cleanly across systems are split per system in the contract instead of forced into a lowest-common-denominator API.

## Open questions (parked)

- Where the human-summary string is composed (server vs. client). Probably client-side for client-dispatched ops, server-side for direct ops. To be settled when the module source begins.
- Whether to expose a "raw JS" escape hatch tool. Lean no for v1 — too dangerous over voice.

(Undo strategy and compendium pinning have been decided in `docs/safety-and-permissions.md`.)
