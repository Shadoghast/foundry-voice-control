# API Contract

This is the spec the module implements and Claude calls against. It defines tool naming, request/response shape, error conventions, the v1 tool catalog, and which tools are system-gated.

## Conventions

### Tool naming

`verb_object`, snake_case. Action tools mutate state; perception tools are pure reads. Examples: `activate_scene`, `create_actor`, `target_tokens`, `describe_scene`.

### Request envelope

Each tool takes a JSON body. Common parameters:

```jsonc
{
  "params": { /* tool-specific */ },
  "options": {
    "dry_run": false,        // if true, validate + describe but don't mutate
    "request_id": "uuid",    // optional client id; echoed back
    "system_hint": "dnd5e"   // optional; if present, server validates against it
  }
}
```

`dry_run` is universal. For action tools it returns the same `summary` and `data` it *would* have returned, with `data.dry_run: true` and no state change. For perception tools it's a no-op.

### Response envelope (success)

```jsonc
{
  "ok": true,
  "summary": "Activated scene 'Bridge of Khazad-Dum'.",
  "data": { /* tool-specific */ },
  "warnings": [
    { "code": "fallback_used", "message": "No exact name match; used fuzzy with score 0.91." }
  ],
  "request_id": "uuid",
  "dispatched_to_client": true
}
```

`summary` is a single sentence suitable for reading aloud. `data` is the structured machine result. `warnings` are non-fatal advisories — still `ok: true`. `dispatched_to_client` tells Claude whether the op needed a connected GM (useful for diagnosing why an op failed if the GM later disconnects).

### Response envelope (error)

```jsonc
{
  "ok": false,
  "summary": "I couldn't find a scene called 'Brigade of Cosmos'. Did you mean 'Bridge of Khazad-Dum'?",
  "error": {
    "code": "not_found",
    "kind": "scene",
    "query": "Brigade of Cosmos",
    "suggestions": [
      { "id": "scn_abc123", "name": "Bridge of Khazad-Dum", "score": 0.62 }
    ]
  },
  "request_id": "uuid"
}
```

`summary` is voice-friendly; `error` is machine-actionable. Suggestions are included whenever the resolver failed but had near-misses — Claude can either retry with a suggestion or read it back to the user.

### Error codes

| Code | When | Includes |
|------|------|----------|
| `not_found` | Resolver found nothing | `kind`, `query`, `suggestions[]` |
| `ambiguous` | Multiple matches above threshold | `kind`, `query`, `candidates[]` |
| `validation` | Bad input | `field`, `expected`, `received` |
| `permission` | Key lacks required scope | `required_scope`, `key_scopes` |
| `gm_unavailable` | Client-required op, no GM connected | `tool_name` |
| `system_unsupported` | Tool needs a system not loaded | `tool_name`, `active_system`, `supported_systems` |
| `timeout` | Dispatch to client exceeded budget | `tool_name`, `timeout_ms` |
| `rate_limited` | Per-key rate-limit exceeded | `reason`, `retry_after_ms` |
| `internal` | Catch-all; details server-logged | `correlation_id` |

Rate-limit responses also set the `Retry-After` HTTP header in seconds.

Errors never leak stack traces or settings.db contents. `internal` returns a correlation id the user can quote when filing a bug.

### Permission scopes

Every tool declares one required scope. The API key has one or more granted scopes; safety doc covers issuance.

| Scope | Grants |
|-------|--------|
| `read` | All perception tools |
| `scene` | `activate_scene`, `select_tokens`, `target_tokens`, untargets, deselects |
| `actor-write` | `create_actor`, `update_actor`, `set_actor_image`, `set_token_image`, `place_token` |
| `roll` | `use_item`, `roll` |
| `gm` | Superset of all the above |

A `read+scene` key is the minimum useful set for "operate the table during play." `gm` is destructive and should be issued sparingly.

### Naming and resolution

For any parameter that takes an `id_or_name`, the server attempts in order:
1. Exact id match.
2. Exact name match (case-insensitive, trimmed).
3. Fuzzy name match (Levenshtein normalized, threshold configurable per tool).

If step 3 produces multiple candidates above threshold, the server returns `ambiguous` rather than guessing. Claude is expected to either pick from `candidates` (when context disambiguates) or ask the user.

## Tool catalog (v1)

System-agnostic unless marked. Each tool lists params (required `*`), required scope, and dispatch target.

### Scene tools

**`activate_scene`** — `scene` — *server*
- params: `scene*` (id_or_name)
- result: `{ scene: {id, name}, previous_scene: {id, name} }`
- summary: `"Activated scene '<name>'."`

**`list_scenes`** — `read` — *server*
- params: `{ filter?: string, include_inactive?: bool }`
- result: `{ scenes: [{id, name, thumb, active}] }`
- summary: `"There are <n> scenes; <m> match '<filter>'."`

**`get_active_scene`** — `read` — *server*
- params: none
- result: `{ scene: {id, name, grid, dimensions} }`

### Token tools

**`select_tokens`** — `scene` — *client*
- params: `{ targets: [id_or_name | spec]*, additive?: bool }`
- result: `{ selected: [{token_id, actor_name}] }`

**`deselect_tokens`** — `scene` — *client*
- params: `{ token_ids?: [string] }` *(omit to clear all)*

**`target_tokens`** — `scene` — *client*
- params: `{ targets: [id_or_name | spec]*, additive?: bool }`
- result: `{ targeted: [{token_id, actor_name}] }`

**`untarget_tokens`** — `scene` — *client*
- params: `{ token_ids?: [string] }`

**`place_token`** — `actor-write` — *client*
- params: `{ actor*: id_or_name, scene?: id_or_name, x?, y?, hidden?: bool }`
- if `scene` omitted, uses active scene; if `x,y` omitted, snaps to viewport center
- result: `{ token_id, scene_id, x, y }`

**`set_token_image`** — `actor-write` — *server*
- params: `{ token*: id_or_name, image*: path | url, scope?: "this_token"|"prototype"|"both" }`
- `prototype` updates the actor's prototype token (affects future placements); `this_token` updates only the placed token. Default: `this_token`.

### Actor tools

**`create_actor`** — `actor-write` — *server*
- params: `{ name*, type*: string, system*: object, img?, prototype_token?: object, items?: [object] }`
- `system` and `items` are validated against `references/systems/<active>.md` schema. Returns `validation` error with `expected` if the spec doesn't match.
- result: `{ actor_id, name, type }`

**`update_actor`** — `actor-write` — *server*
- params: `{ actor*: id_or_name, patch*: object }`
- patch is a deep merge using Foundry's `Actor#update` semantics (dot-notation paths supported).
- result: `{ actor_id, changes_applied: [string] }`

**`get_actor`** — `read` — *server*
- params: `{ actor*: id_or_name, fields?: [string] }`
- result: `{ actor: {…} }` — full actor doc unless `fields` provided

**`find_actor`** — `read` — *server*
- params: `{ query*: string, type?: string, limit?: int }`
- result: `{ matches: [{id, name, type, score}] }`

**`set_actor_image`** — `actor-write` — *server*
- params: `{ actor*: id_or_name, image*: path | url, also_update_prototype_token?: bool }`

**`delete_actor`** — `gm` — *server*
- params: `{ actor*: id_or_name, confirm: true }`
- requires explicit `confirm: true` even with the `gm` scope. Hard-deleting is destructive enough to demand a verbal confirmation step in voice flows.

### Item / ability tools

**`list_items`** — `read` — *server*
- params: `{ actor*: id_or_name, type_filter?: string }`
- result: `{ items: [{id, name, type}] }`

**`add_item`** — `actor-write` — *server* *(system-gated for spec validation)*
- params: `{ actor*: id_or_name, item*: spec | { compendium*: string, name*: string } }`
- result: `{ item_id, name }`

**`remove_item`** — `actor-write` — *server*
- params: `{ actor*: id_or_name, item*: id_or_name }`

**`update_item`** — `actor-write` — *server* *(system-gated)*
- params: `{ actor*: id_or_name, item*: id_or_name, patch*: object }`

**`use_item`** — `roll` — *client* — **system-gated**
- params: `{ actor*: id_or_name, item*: id_or_name, options?: object }`
- Behavior is system-specific; defined in each `references/systems/<id>.md`. Universal contract: returns `{ rolls: [{formula, total, results}], chat_message_id }` plus a voice summary like `"Greatsword attack: 17 to hit, 9 slashing damage."`

**`roll`** — `roll` — *client* — **system-gated**
- params: `{ actor*: id_or_name, kind*: "skill"|"save"|"attack"|"custom", target*: string, options?: object }`
- `target` is system-defined: a skill key, save key, item id for attacks, or formula for custom. Per-system reference enumerates valid `target` values.

### Perception tools

**`describe_scene`** — `read` — *server+client*
- params: `{ scene?: id_or_name, focus?: "tokens"|"layout"|"combat"|"all" }`
- Returns a natural-language summary suitable for reading aloud. The server composes from world data; client adds canvas-only details (vision, current selection) when a GM is connected. With no GM connected, returns the server-only portion and a warning.
- result: `{ scene_id, description: string, untrusted_description?: { untrusted: true, content: string } }`
- The envelope's top-level `summary` is the one-sentence headline voice reads by default. `data.description` is the longer multi-sentence version used when the user asks for "more detail." `data.untrusted_description` is present only when the scene has a player- or GM-authored prose description — kept structurally separate per safety doc's untrusted-content rules.

**`get_scene_state`** — `read` — *server+client*
- params: `{ scene?: id_or_name }`
- result: `{ tokens: [{id, actor_id, name, x, y, disposition, hp_pct, statuses, controlled, targeted}], walls_summary, lighting_summary }`
- Designed for Claude to reason over spatially without screenshots.

**`get_world_state`** — `read` — *server*
- params: none
- result: `{ active_scene, connected_users, in_combat, system_id, system_version }`

## System gating

Tools marked **system-gated** must have an entry in the active system's reference under `references/systems/<id>.md`. The module loads system handlers at boot and exposes them via a registry. If a system-gated tool is invoked under a system without a handler, the response is `system_unsupported` with the list of supported systems, not silent failure.

Universal tools (the rest) work by hitting Foundry's core APIs directly and don't care about system. They will still produce sensible behavior under any system, even ones not formally supported, though `create_actor` validation falls back to "permissive" mode and only checks core fields.

## Versioning

The contract version is exposed via `get_world_state().contract_version`. Breaking changes bump the major version; additions bump minor; bug fixes bump patch. The MCP tool descriptions Claude sees include the version so a stale Claude config is detectable on the first call.

## Open items

- **Compendium semantics for `add_item`.** Should the module pin to specific compendium versions, or always grab the latest? Defer to safety doc (versioning of game content has reproducibility implications).
- **Streaming results.** Some rolls (multi-attack sequences) produce multiple chat messages. v1 returns the full set in one response; v2 may stream.
- **Bulk operations.** No `select_tokens` for ranges-and-areas yet; if it's needed for voice ("select everyone in the front rank") we'll add a `select_tokens_by_area` tool rather than overloading `select_tokens`.
- **Undo.** The contract is silent on undo; `safety-and-permissions.md` decides whether undo is built into the response envelope (e.g., `data.undo_token`) or a separate tool.
