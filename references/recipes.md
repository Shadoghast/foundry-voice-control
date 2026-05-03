# Operation Recipes

One step-by-step recipe per tool in the v1 contract. Each recipe assumes auth and rate-limit checks have already passed (per `docs/safety-and-permissions.md`) and focuses on the orchestration: API calls in order, validation, summary composition, error handling.

Throughout, `<server>` means runs in the Foundry Node process, `<client>` means dispatched to the connected GM's browser via the module socket layer. Universal calls reference `references/core-foundry-api.md`. System-specific calls reference `references/systems/<id>.md`.

## Reading the recipes

Each block has the same shape:

- **Scope** / **Dispatch** / **System-gated** — copied from the contract for quick scan.
- **Steps** — numbered. The number of the step that fails determines the error code returned.
- **Summary template** — what the success summary looks like; voice-design reads it verbatim.
- **Errors** — the common failure modes specific to this tool, beyond the universal ones.
- **Notes** — gotchas, edge cases, links.

Universal errors handled by every tool (not repeated below): `validation` for bad input, `permission` for scope mismatch, `internal` for unexpected exceptions, `timeout` for client-dispatch budget exceeded.

---

## Scene tools

### `activate_scene`

- **Scope:** `scene` · **Dispatch:** `<server>` · **System-gated:** no

**Steps:**

1. Resolve `scene` (id_or_name) against `game.scenes`. If `not_found`, return with suggestions.
2. Capture `previous = game.scenes.active` for the response and undo snapshot.
3. `await scene.activate()`.
4. Snapshot for undo: `{ previous_scene_id: previous?.id }`. Issue `undo_token`.
5. Return `{ scene: { id, name }, previous_scene: { id, name } }` plus `summary`.

**Summary:** `"Activated scene '<name>'."`

**Errors:** `not_found` (kind: `scene`).

**Notes:** `scene.activate()` causes `canvasReady` to fire on every connected client. Subsequent client-dispatched ops on this scene should `await whenCanvasReady()` before running.

---

### `list_scenes`

- **Scope:** `read` · **Dispatch:** `<server>` · **System-gated:** no

**Steps:**

1. Read `game.scenes`. If `filter` provided, fuzzy-match names with low threshold.
2. Build `[{ id, name, thumb, active }]`. Sort active first, then alpha.
3. Return.

**Summary:** `"<n> scenes total<, <m> match '<filter>'>."`

**Errors:** none beyond universal.

---

### `get_active_scene`

- **Scope:** `read` · **Dispatch:** `<server>` · **System-gated:** no

**Steps:**

1. Read `game.scenes.active`. If null (no active scene), return a `not_found` with `kind: "active_scene"`.
2. Return `{ scene: { id, name, grid, dimensions } }`.

**Summary:** `"Active scene is '<name>'."` or `"No scene is currently active."`

---

## Token selection / targeting

### `select_tokens` / `deselect_tokens` / `target_tokens` / `untarget_tokens`

- **Scope:** `scene` · **Dispatch:** `<client>` · **System-gated:** no

These four share most of the recipe. The differences are which canvas method is called and how `additive` is interpreted.

**Steps (select_tokens / target_tokens):**

1. `await whenCanvasReady()`.
2. For each entry in `targets`:
   - If id, look up the canvas Token by id (`canvas.tokens.get(id)`).
   - If name, fuzzy-match `canvas.tokens.placeables` by `token.name` (the token's own name, which may differ from the actor's).
   - If spec object, future expansion (e.g., `{disposition: "hostile", min_hp_pct: 0}`); v1 returns `validation` if anything beyond id_or_name is provided.
3. If any entry resolves to multiple matches above threshold, return `ambiguous` with `candidates`. If none resolve at all, return `not_found` with the failing query.
4. Snapshot prior selection / target state for undo.
5. For select: call `token.control({ releaseOthers: !additive })` on the first, then `releaseOthers: false` on the rest. For target: `token.setTarget(true, { releaseOthers: !additive, user: game.user })` likewise.
6. Build `selected` / `targeted` array of `{ token_id, actor_name }`.
7. Return.

**Steps (deselect_tokens / untarget_tokens):**

1. `await whenCanvasReady()`.
2. If `token_ids` provided, untarget/deselect each. If omitted, clear all (`canvas.tokens.releaseAll()` / `game.user.updateTokenTargets([])`).
3. Snapshot prior state for undo.
4. Return `{ cleared: <n> }`.

**Summary patterns:**

- `select_tokens`: `"Selected <n> token<s>: <name1>, <name2>."` (cap names at 3, then "and N others")
- `deselect_tokens`: `"Cleared selection (<n> tokens)."` or `"Deselected <n> tokens."`
- `target_tokens`: `"Targeting <n> token<s>: <name1>, <name2>."`
- `untarget_tokens`: `"Cleared targets."`

**Errors:** `not_found`, `ambiguous`, `gm_unavailable`.

**Notes:** Token names and actor names can differ. The resolver tries token name first, falls back to actor name. Selection and targeting are purely client-side — they don't persist across reconnects (as of v14).

---

## Token placement and image

### `place_token`

- **Scope:** `actor-write` · **Dispatch:** `<client>` (for `canvasReady` + viewport center fallback) · **System-gated:** no

**Steps:**

1. Resolve `actor` (id_or_name).
2. Resolve `scene` if provided; default to `game.scenes.active`. If neither, return `validation` ("no scene to place into").
3. If the target scene isn't currently viewed by the GM client, render it via `scene.view()` so canvas state is sane. Restore prior viewed scene at the end.
4. `await whenCanvasReady()`.
5. Compute `(x, y)`: if provided, use directly (snap to grid). If omitted, use the canvas viewport center.
6. `const protoData = (await actor.getTokenDocument({ x, y, hidden: !!hidden })).toObject();`
7. `const [tokenDoc] = await canvas.scene.createEmbeddedDocuments("Token", [protoData]);`
8. Snapshot for undo: `{ scene_id, token_id }` (undo deletes the placed token).
9. Return `{ token_id, scene_id, x, y }`.

**Summary:** `"Placed <actor.name> on '<scene.name>'."`

**Errors:** `not_found` (actor), `not_found` (scene), `gm_unavailable`, `validation`.

**Notes:** `getTokenDocument` returns a TokenDocument constructed from the actor's `prototypeToken` plus overrides. Don't try to construct token data manually — the prototype contains vision settings, disposition, bar configuration, etc. that you'd otherwise miss.

---

### `set_token_image`

- **Scope:** `actor-write` · **Dispatch:** `<server>` (universal data update; canvas auto-refreshes) · **System-gated:** no

**Steps:**

1. Resolve `token` (id_or_name) — searches active scene's tokens by id, then by name (token name first, actor name fallback).
2. Validate `image`:
   - If a path, canonicalize and assert it lives under `<userData>/Data/`. Reject otherwise per safety doc.
   - If a URL, check against the URL allowlist (default empty), reject SVG content type, fetch with size cap and no redirects.
3. Snapshot prior image refs based on `scope`:
   - `this_token`: `tokenDoc.texture.src`
   - `prototype`: `actor.prototypeToken.texture.src`
   - `both`: capture both
4. Apply updates:
   - `this_token`: `await tokenDoc.update({ "texture.src": image })`
   - `prototype`: `await actor.update({ "prototypeToken.texture.src": image })`
   - `both`: do both in sequence
5. Issue `undo_token`.
6. Return `{ token_id, scope_applied, previous_image, new_image }`.

**Summary:** `"Updated <scope> image for <actor.name>."`

**Errors:** `not_found`, `validation` (path/URL rejected).

**Notes:** Updating the prototype affects future placements only; existing placed tokens keep their current image. `both` is the right default when the user says "change this NPC's portrait" — they usually mean for the future too.

---

## Actor tools

### `create_actor`

- **Scope:** `actor-write` · **Dispatch:** `<server>` · **System-gated:** for `system` payload validation only

**Steps:**

1. Validate base fields: `name` (non-empty string), `type` (must match a registered subtype on the active system; check `game.system.documentTypes.Actor`).
2. Load the active system handler. Validate the `system` payload against the system's actor schema (per `references/systems/<id>.md`). If unrecognized fields, return `validation` with the offending paths.
3. If `items` provided, validate each item's `type` and `system` payload similarly.
4. `const actor = await Actor.create({ name, type, img, prototypeToken, system, items });`
5. Snapshot for undo: `{ actor_id }` (undo deletes the actor).
6. Return `{ actor_id, name, type }`.

**Summary:** `"Created <type> '<name>'<. with <n> item(s)>."`

**Errors:** `validation`, `system_unsupported`.

**Notes:** Actors are created in the world's actor directory by default. For folder placement, accept an optional `folder_id` parameter (deferred from v1). Token prototype defaults from the system; only override fields you actually want to set.

---

### `update_actor`

- **Scope:** `actor-write` · **Dispatch:** `<server>` · **System-gated:** for `system.*` paths

**Steps:**

1. Resolve `actor`.
2. Flatten `patch` to dot-notation paths; classify each path:
   - Universal paths (`name`, `img`, `prototypeToken.*`) — pass through.
   - `system.*` paths — validate against the active system's schema. Reject unknown paths with `validation`.
   - `items` keys — reject with `validation` and a hint pointing to `add_item` / `remove_item` / `update_item`.
3. Snapshot pre-state of the affected paths for undo.
4. `await actor.update(patch)`. Capture which fields actually changed (Foundry returns the doc; diff to determine).
5. Return `{ actor_id, changes_applied: [<paths>] }`.

**Summary:** `"Updated <name> (<n> field<s>)."`

**Errors:** `not_found`, `validation`.

**Notes:** Foundry no-ops silently when patching paths the DataModel doesn't define — that's why we validate up front. Array fields don't deep-merge; replace whole arrays via the per-system reference's guidance.

---

### `get_actor`

- **Scope:** `read` · **Dispatch:** `<server>` · **System-gated:** no

**Steps:**

1. Resolve `actor`.
2. If `fields` provided, project the actor object. Otherwise return the full doc.
3. Wrap any user-authored prose fields (bio, description) per the safety doc's untrusted-content marker.
4. Return `{ actor }`.

**Summary:** `"<name> — <type>, HP <current>/<max><, <list selected fields>>."` Two-sentence cap; if more requested, paginate with offer.

**Errors:** `not_found`.

**Notes:** The HP shorthand in the summary uses universal paths (`system.attributes.hp.value` / `.max`) when present; per-system reference can override the summary template for systems that don't follow that convention.

---

### `find_actor`

- **Scope:** `read` · **Dispatch:** `<server>` · **System-gated:** no

**Steps:**

1. Validate `query`: not empty, not whitespace, not a single character (per safety doc).
2. Score all actors by Levenshtein-normalized name distance. Filter by `type` if provided.
3. Sort by score desc, cap at `limit ?? 10`.
4. If "respect ownership" mode is enabled and the key is non-`gm`, drop actors with restricted ownership.
5. Return `{ matches: [{ id, name, type, score }] }`.

**Summary:** `"<n> match '<query>'. Top: <name1>, <name2>."` (cap names at 2 in summary; full list is in `data`)

**Errors:** `validation` (empty/short query).

---

### `set_actor_image`

- **Scope:** `actor-write` · **Dispatch:** `<server>` · **System-gated:** no

**Steps:**

1. Resolve `actor`.
2. Validate `image` (same path/URL rules as `set_token_image`).
3. Snapshot prior `actor.img` (and `prototypeToken.texture.src` if `also_update_prototype_token`).
4. Apply: `await actor.update({ img: image, ...(alsoProto ? { "prototypeToken.texture.src": image } : {}) })`.
5. Issue `undo_token`.
6. Return `{ actor_id, previous_image, new_image, prototype_updated }`.

**Summary:** `"Updated portrait for <name><, prototype too>."`

**Errors:** `not_found`, `validation`.

---

### `delete_actor`

- **Scope:** `gm` · **Dispatch:** `<server>` · **System-gated:** no

**Required:** `confirm: true` (per contract). Voice flow runs `dry_run: true` first.

**Steps:**

1. Resolve `actor`.
2. If `dry_run`, return preview: `{ would_delete: { actor_id, name, type, item_count, has_active_combat: bool }, dry_run: true, requires_confirmation: true, hold_token }`.
3. If `confirm: true`, snapshot full actor data + embedded items into undo store.
4. `await actor.delete()`.
5. Issue `undo_token`.
6. Return `{ actor_id, undo_token }`.

**Summary (dry-run):** `"Would delete <type> '<name>' (<n> items<, in active combat>)."`
**Summary (commit):** `"<name> deleted. Undo token saved for an hour."`

**Errors:** `not_found`, `validation` (missing confirm).

**Notes:** Per voice-design, the dry-run preview is what gets read aloud first; commit happens after verbal confirm. Do NOT delete an actor that is the only member of an active combat without warning — surface the `has_active_combat` field in the dry-run summary.

---

## Item / ability tools

### `list_items`

- **Scope:** `read` · **Dispatch:** `<server>` · **System-gated:** no

**Steps:**

1. Resolve `actor`.
2. Filter `actor.items` by `type_filter` if provided.
3. Return `{ items: [{ id, name, type }] }`.

**Summary:** `"<n> item<s> on <actor.name><, <m> filter match>."`

---

### `add_item`

- **Scope:** `actor-write` · **Dispatch:** `<server>` · **System-gated:** for spec validation

**Two paths depending on `item` shape:**

**Path A — inline spec:**

1. Resolve `actor`.
2. Validate `item.type` against system's registered item subtypes.
3. Validate `item.system` against the system's item schema.
4. `const [created] = await actor.createEmbeddedDocuments("Item", [item]);`

**Path B — compendium reference:**

1. Resolve `actor`.
2. `const pack = game.packs.get(item.compendium); if (!pack) → not_found`.
3. `const index = await pack.getIndex(); const entry = index.find(e => e.name === item.name); if (!entry) → not_found`.
4. `const source = await pack.getDocument(entry._id);`
5. Capture `pack.metadata.version` (or current pack signature) for compendium pinning per safety doc.
6. `const [created] = await actor.createEmbeddedDocuments("Item", [{ ...source.toObject(), flags: { "foundry-voice-control": { compendium: { pack_id: pack.collection, entry_id: entry._id, pack_version } } } }]);`

**Both paths:**

7. Snapshot for undo: `{ actor_id, item_id }` (undo deletes the embedded item).
8. Return `{ item_id, name }`.

**Summary:** `"Added <name> to <actor.name>."`

**Errors:** `not_found` (actor / pack / entry), `validation`.

---

### `remove_item`

- **Scope:** `actor-write` · **Dispatch:** `<server>` · **System-gated:** no

**Steps:**

1. Resolve `actor`, then resolve `item` against `actor.items` by id or name.
2. Snapshot the full item doc for undo.
3. `await actor.deleteEmbeddedDocuments("Item", [item.id])`.
4. Issue `undo_token`.
5. Return `{ actor_id, item_id, name }`.

**Summary:** `"Removed <item.name> from <actor.name>."`

**Errors:** `not_found`, `ambiguous`.

---

### `update_item`

- **Scope:** `actor-write` · **Dispatch:** `<server>` · **System-gated:** for `system.*` paths

**Steps:**

1. Resolve `actor` and `item`.
2. Flatten `patch`. Validate `system.*` paths against the system's item schema. Universal paths (`name`, `img`) pass through.
3. Snapshot pre-state of affected paths.
4. `await actor.updateEmbeddedDocuments("Item", [{ _id: item.id, ...patch }])`.
5. Issue `undo_token`.
6. Return `{ item_id, changes_applied }`.

**Summary:** `"Updated <item.name> on <actor.name> (<n> field<s>)."`

---

### `use_item`

- **Scope:** `roll` · **Dispatch:** `<client>` · **System-gated:** YES

**Steps:**

1. Confirm the active system has a handler in the system registry. If not, return `system_unsupported`.
2. Resolve `actor` and `item`.
3. Hand off to the system handler with `{ actor, item, options }`. The handler is responsible for the system-specific use flow (rolling attacks, consuming uses, posting chat messages, etc.). See `references/systems/<id>.md` for what each handler accepts and returns.
4. The handler returns `{ rolls: [...], chat_message_id, summary }`.
5. **Not undoable** per safety doc. No snapshot.
6. Return.

**Summary:** Composed by the system handler; voice-design reads it for ear (e.g., `"Greatsword: seventeen to hit, nine slashing."`).

**Errors:** `system_unsupported`, `not_found`, plus system-specific errors.

---

### `roll`

- **Scope:** `roll` · **Dispatch:** `<client>` · **System-gated:** YES

**Steps:**

1. Validate `kind` (`skill | save | attack | custom`).
2. Confirm system handler exists.
3. Resolve `actor`.
4. Hand off to the system handler with `{ actor, kind, target, options }`. The handler validates `target` against the system's roll surface (skill keys, save keys, item ids for attacks, formula strings for custom).
5. Handler returns `{ formula, total, results, chat_message_id, summary }`.
6. **Not undoable.**
7. Return.

**Summary:** Composed by handler; voice-design reads numbers for ear.

---

## Perception tools

### `describe_scene`

- **Scope:** `read` · **Dispatch:** `<server>` + `<client>` (server-only fallback if no GM connected)

**Steps:**

1. Resolve `scene` (default: `game.scenes.active`).
2. Server portion: gather `{ name, dimensions, grid, token_count, actors_present, lighting_summary }`.
3. If GM is connected and `focus !== "layout-only"`, dispatch to client for live additions: `{ controlled_tokens, targeted_tokens, viewport_center, vision_summary }`.
4. Compose narrative description (1–3 sentences) and a one-sentence summary suitable for voice. Wrap any user-authored scene description in the untrusted marker.
5. Return `{ description, summary, scene_id, focus_used }`.

**Summary:** A single sentence — the headline. `description` is the longer prose paragraph for when the user asks for more.

**Errors:** `not_found`, `gm_unavailable` (only if GM was required for the requested focus).

---

### `get_scene_state`

- **Scope:** `read` · **Dispatch:** `<server>` + `<client>` for canvas-only fields

**Steps:**

1. Resolve `scene`. If active scene and GM connected, gather full state.
2. Build `tokens` array. For each TokenDocument:
   - Universal: `id, actor_id, name, x, y, disposition, hidden`.
   - Computed: `hp_pct` from `actor.system.attributes.hp` if present.
   - Statuses: `Array.from(token.actor?.statuses ?? [])`.
   - Client-only (added if GM connected): `controlled` (in `canvas.tokens.controlled`), `targeted` (in `game.user.targets`).
3. Build `walls_summary` and `lighting_summary` (counts and rough categories — not full geometry).
4. Return.

**Summary:** `"<n> token<s> on '<scene>'<, <m> hostile, <k> ally>."`

**Notes:** Designed for Claude to reason spatially without screenshots. Don't include token textures, vision data, or ownership flags — keep it lean.

---

### `get_world_state`

- **Scope:** `read` · **Dispatch:** `<server>` · **System-gated:** no

**Steps:**

1. Read `game.scenes.active`, `game.users.filter(u => u.active)`, `game.combat`, `game.system.id`, `game.system.version`.
2. Build the contract version from the module's manifest.
3. Return.

**Summary:** `"System <system_id> v<version>; <n> user<s> connected; active scene '<name>'<; combat in progress>."`

---

## Undo

### `undo`

- **Scope:** Same as the original mutation's scope. The token carries its required scope; the server enforces it on undo.
- **Dispatch:** Same as the original.

**Steps:**

1. Look up snapshot by `token`. If not found / expired, return `not_found` (kind: `undo_token`).
2. If `gm_required` was true on the original op and no GM is connected now, return `gm_unavailable`.
3. Verify the snapshot's `scope_required` is held by the calling key.
4. Apply the inverse operation per the reversibility table in safety-and-permissions.md.
5. Mark the snapshot consumed (one-shot — undo doesn't undo).
6. Return `{ original_tool, original_summary, undone: true }`.

**Summary:** `"Undone: <original_summary>"`

**Errors:** `not_found`, `gm_unavailable`, `permission`.

**Notes:** Undo of `create_actor` deletes the actor. Undo of `delete_actor` re-creates from snapshot, restoring the original `_id` so existing references aren't broken. Undo of `place_token` deletes the placed token.
