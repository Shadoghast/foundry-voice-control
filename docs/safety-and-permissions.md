# Safety and Permissions

The contract in `api-contract.md` defines *what* tools exist. This doc defines *under what conditions* they may run and what the module must do to keep a personal/group game safe from stolen keys, runaway agents, misheard commands, and malicious world content.

## Threat model (in scope)

- A leaked or stolen API key being used to mutate or read the world.
- A runaway Claude session looping a destructive tool until the world is corrupted.
- Misheard or maliciously-spoken voice commands resolving to the wrong actor or scene.
- Untrusted text inside the world (player-authored bios, item descriptions, journal entries) attempting prompt injection through perception tools.
- Other Foundry modules on the same instance reading our keys file or settings.
- A casual scanner discovering the module's routes and probing for vulnerabilities.

Out of scope: nation-state attackers, shared multi-tenant hosting hardening, public-service-grade hardening. This is a personal-game control plane.

## Authentication

### Key issuance

Keys are created via Foundry chat command, only by a connected GM:

```
/voice key new <label> --scopes=<comma-list> [--expires=<duration>]
/voice key list
/voice key revoke <id>
/voice key rotate <id> [--grace=<duration>]
/voice revoke-all
```

Each key carries: `id`, `label`, `scopes[]`, `created_at`, `last_used_at`, `last_used_ip`, optional `expires_at`, `revoked_at`. The raw value is **shown once** at issuance and never again. The GM copies it into the MCP config; if lost, the key is revoked and a replacement issued.

### Storage

- Keys are stored as **Argon2id hashes**, salted per key, in a server-only JSON file (`<userData>/Data/modules/foundry-voice-control/keys.json`) outside Foundry's `settings.db`.
- File mode `0600`, owned by the Foundry process user.
- Not included in world export/backup. Backups carry only the metadata (id, label, scopes, timestamps), never hashes or values.
- The plaintext value exists only in transit and in the user's MCP config.

### Scopes

The five scopes defined in `api-contract.md` (`read`, `scene`, `actor-write`, `roll`, `gm`) gate every tool. The server enforces the scope check **server-side on every call**, independent of any client claim. Scopes are union-ed across the granted set.

Recommended presets:

| Preset | Scopes | Use |
|--------|--------|-----|
| Operator (default) | `read+scene+actor-write+roll` | Voice-driven table operation |
| Read-only | `read` | Audit, safe disambiguation, perception-only sessions |
| GM | `read+scene+actor-write+roll+gm` | Destructive ops; issue sparingly |

### Rotation and revoke

- `/voice key rotate <id>` issues a replacement; both keys work for a configurable grace window (default 5 minutes), then the old one auto-revokes. Lets a session rotate without breaking mid-call.
- `/voice revoke-all` is the panic command — disables every key in one chat line, surfaces a confirmation prompt, requires GM role.
- Expired and revoked keys return `permission` errors, never `not_found` (so the user knows it's an auth issue, not a route issue).

## Transport

- **TLS required.** The route handler refuses requests on plain HTTP regardless of which proxy delivered them. If the request's `X-Forwarded-Proto` is `http`, reject. If unset, require the connection itself to be TLS.
- **Bearer header only.** `Authorization: Bearer <key>`. Reject any key sent via cookie, query string, or non-bearer scheme.
- **No CORS, no preflight.** `OPTIONS` returns 405. Claude doesn't need cross-origin browser access.
- **404 on unauthenticated requests.** Any request without a valid bearer returns 404, not 401, so unauthenticated scanners can't even confirm the module is installed. Authenticated callers with the wrong scope still get 403/`permission` so they can debug.
- **Optional IP allowlist.** A module setting (server-only) lets the user pin acceptable source IPs or CIDRs; empty means no restriction. The check runs after TLS, before auth.

## Input validation

### Images and URLs

- **Path inputs** to `set_token_image` / `set_actor_image` are canonicalized and rejected if they resolve outside `<userData>/Data/`. No `..`, no symlink escapes.
- **URL inputs** must be `https://` (or `http://` only if the Foundry instance itself is local). Hosts must be on the configurable allowlist; default allowlist is empty (URLs disabled). Reject any IP that resolves to RFC1918, link-local, loopback, or known cloud-metadata addresses (169.254.169.254, fd00:ec2::254, etc.).
- **Image fetches** cap at 5 MB, content-type `image/*` only, no redirect following.
- **SVG is rejected by default in v1.** Configurable opt-in for users who understand the XSS surface.

### Request bodies

- JSON only; reject other content types with 415.
- Max body size 256 KB (rejected with 413).
- Max object depth 16 (rejected with `validation` error).
- Strict schema: unknown top-level fields in `params` cause `validation` errors with the offending field name.

### Resolver inputs

- `find_actor`, `select_tokens`, `target_tokens` and any tool that takes a free-text name **refuse empty, whitespace-only, or single-character queries**. Most are transcription noise from voice.
- Fuzzy threshold is tuned per tool (more permissive for `find_actor`, stricter for destructive resolvers).

## Output and information disclosure

### Errors

- Error responses include only: `code`, `kind`, the original `query` if relevant, and `suggestions[]` / `candidates[]` when fuzzy matching produced near-misses.
- No stack traces. No file system paths. No internal Foundry version strings beyond `system_id` / `system_version` in `get_world_state`.
- `internal` errors return a `correlation_id` only; the actual exception goes to the server log keyed by that id.

### Logging

The module's request log redacts:

- The full `Authorization` header.
- `params.patch` on `update_actor` and `update_item` (may contain secrets users have stuffed into actor flags).
- URL parameters on image fetches (in case of credentialed URLs).

The redaction is enforced by the log writer, not by convention — the writer takes a structured request object and only ever logs an allowlist of fields.

### Audit log

A separate, GM-readable audit log captures every tool invocation:

```
timestamp | key_id | scope_used | tool | success/fail | source_ip | request_id
```

- 7-day rolling retention by default; configurable.
- Visible via `/voice audit show [--last=N]` chat command and a small settings panel.
- Audit entries never include parameter values — only the metadata above. (Preserves auditability without leaking patches.)

## Authorization rules

- Scope check is server-side, on every call, before dispatch. A client cannot self-attest scope.
- GM-presence is re-checked at dispatch time, not cached. The "first GM connected wins" rule from `architecture.md` applies; if that GM disconnects between auth and dispatch, the call fails with `gm_unavailable`.
- **Deletion ops require explicit confirm.** `delete_actor` requires `confirm: true` per `api-contract.md`; that is the only tool with the requirement in v1. Voice flows for deletions dry-run first, read the summary back, and only then re-issue with `confirm: true`. We can expand the trigger set later if usage shows other ops are easy to fire by mistake.
- **Optional "respect ownership" mode.** A module setting can make `find_actor` and `list_items` treat actors with restricted ownership as not-found for non-`gm` scope keys. Default off (personal game), but available.

## Abuse and rate limits

| Limit | Default | Scope |
|-------|---------|-------|
| Total requests | 60 / minute | per key |
| Mutations | 10 / minute | per key |
| Destructive (delete + bulk update) | 5 / minute | per key |
| `create_actor` | 50 / hour | per key |
| `delete_actor` | 20 / hour | per key |
| Failed-auth attempts | 30 / hour | per source IP, then exponential backoff |

Rate-limit responses return 429 with `Retry-After`. The audit log records throttled calls so abuse is visible.

## Voice-specific safeties

- **Dry-run-first for deletion voice flows.** When a voice-dispatched deletion tool is called, the module's response includes `data.requires_confirmation: true` and the action is held; Claude reads the summary back, the user verbally confirms, Claude re-issues the call with `confirm: true`. The held action expires after 60 seconds. Other potentially-impactful ops (large patches, HP-to-zero updates) may use the same pattern at Claude's discretion via voice-design rules, but it is not module-enforced.
- **Untrusted content marker.** Perception tools return any user-authored free text wrapped:

```jsonc
{ "untrusted": true, "content": "<actor bio text>" }
```

This is the protocol-level signal. `voice-design.md` defines how Claude treats it. Names, system stats, and module-authored fields are *not* wrapped — only player/GM-authored prose.

- **Push-to-talk** is the user's responsibility, not the module's. Documented as a known limitation: anyone in earshot of the GM can in principle issue commands.
- **Tool descriptions are pinned.** Claude's MCP config carries the tool descriptions. The module's `get_world_state` reports a `contract_version`; on mismatch Claude warns rather than silently re-fetching descriptions from the server.

## Undo

Closes the open item from `api-contract.md`.

- **Snapshot-based undo.** Each reversible mutation captures the pre-state and stores it server-side, keyed by `undo_token`, returned in `data.undo_token`.
- A separate tool `undo({ token })` (scope: same as the original mutation) reverses the change.
- **Per-key snapshot cap:** 50 most recent. Older snapshots evict.
- **Snapshot TTL:** 1 hour.
- **Reversibility table:**

| Tool | Reversible | How |
|------|------------|-----|
| `create_actor` | Yes | Delete the created actor |
| `update_actor` | Yes | Replace with snapshot |
| `delete_actor` | Yes | Restore from snapshot |
| `set_actor_image` / `set_token_image` | Yes | Restore prior image ref |
| `place_token` | Yes | Delete placed token |
| `select_tokens` / `target_tokens` | Trivial | Restore prior selection |
| `add_item` | Yes | Remove item |
| `remove_item` / `update_item` | Yes | Restore from snapshot |
| `use_item`, `roll` | **No** | Rolls / chat messages are append-only |
| `activate_scene` | Yes | Re-activate previous scene |

## Compendium pinning

Closes the other open item from `api-contract.md`.

- `add_item` with a compendium reference resolves to `{pack_id, entry_id, pack_version}` at call time.
- The actor's stored item carries those three fields in its `flags.foundry-voice-control` so we can audit later.
- On subsequent reads, the module compares the stored `pack_version` to the current pack version and surfaces a `warning` if they differ. This is informational only — not a refusal.

## Module lifecycle hygiene

- **Boot:** routes return 503 until the module is fully initialized. No window where the route handler is registered but auth isn't ready.
- **Disable:** revoke all active keys, unregister routes, flush in-flight requests with 503.
- **Uninstall:** delete `keys.json`, delete the audit log if the user opts in, drop module settings.
- **Update:** preserve `keys.json` and audit log unless the user explicitly resets them. Module update never re-enables a revoked key.

## Tiering

### Must-do for v1

- Argon2id-hashed keys in a server-only file.
- Scoped keys with the five scopes; `gm` reserved; operator preset.
- TLS-required, bearer-only, no CORS, 404-on-unauthenticated.
- Per-key rate limits and per-source-IP failed-auth backoff.
- Audit log (file-based, 7-day rolling, GM-readable).
- Input validation: image path canonicalization, URL allowlist, payload size and depth caps, SVG rejection.
- Untrusted-content marker on perception output.
- Dry-run-first for deletion voice flows; `confirm: true` enforcement on `delete_actor`.
- Resolver refusal of empty / single-character queries.
- Authorization and patch redaction in logs.
- Panic `revoke-all` chat command.
- Module disable/uninstall hygiene.
- Snapshot-based undo for the reversible tool set above.

### Should-do soon (v1.x)

- IP allowlist for the module routes.
- Per-key expiry and grace-period rotation.
- `last_used_at` / `last_used_ip` in key list output.
- Per-tool destructive quotas separate from per-minute limits.
- Compendium version warnings on stale pack references.
- "Respect ownership" mode for `find_actor` / `list_items`.
- Settings UI panel for keys and audit log (instead of chat-only).

### Explicit non-goals (v1)

- mTLS or client-cert auth.
- Signed requests with replay nonces.
- OAuth device flow or per-user accounts.
- Cross-world key sharing.
- Public-service-grade hardening (DDoS protection, WAF, etc.).
