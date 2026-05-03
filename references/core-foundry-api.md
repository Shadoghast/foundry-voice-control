# Core Foundry API (System-Agnostic)

Practical reference for the Foundry v14 API calls the module relies on. Limited to operations that work regardless of game system. System-specific actor schemas, item types, and roll behaviors live under `references/systems/`.

## Conventions

- **Where things run.** Foundry has two contexts: the Node.js server process (one per world) and a browser client (one per connected user). The same module ships JS for both. `game.*`, `canvas.*`, `ui.*`, and most `Document` APIs work in the client; the server has access to documents via `game.actors.get(...)`-style code only after the world is loaded but cannot touch `canvas.*`. Whenever a section below says "client-only," it means the call must run in a connected browser.
- **Async by default.** Every CRUD call returns a `Promise`. Always `await`. Failing to await is the single most common source of "the change didn't apply" bugs.
- **Document hierarchy.** Top-level documents (`Actor`, `Item`, `Scene`, `JournalEntry`, `Macro`, `Playlist`, `RollTable`, `User`, `Combat`, `ChatMessage`, `Folder`) live in world collections (`game.actors`, `game.items`, etc.). Embedded documents (Items inside an Actor, Tokens inside a Scene, ActiveEffects inside an Actor) live as collections on their parent and are mutated through `createEmbeddedDocuments` / `updateEmbeddedDocuments` / `deleteEmbeddedDocuments`.
- **Patches use dot-notation paths.** `actor.update({ "system.attributes.hp.value": 12 })` is equivalent to a deep-merged object; both work, dot-notation is preferred for clarity.
- **Version guard.** `if (game.release.generation >= 14) { ... }` — the canonical version check.

## Module manifest essentials

`module.json` for the operate module. Minimum useful fields:

```json
{
  "id": "foundry-voice-control",
  "title": "Foundry Voice Control",
  "description": "Voice-controlled operation of Foundry VTT.",
  "version": "0.1.0",
  "compatibility": { "minimum": "14", "verified": "14" },
  "esmodules": ["scripts/client.mjs"],
  "serverEsmodules": ["scripts/server.mjs"],
  "languages": [{ "lang": "en", "name": "English", "path": "lang/en.json" }],
  "socket": true,
  "url": "...",
  "manifest": "...",
  "download": "..."
}
```

- `esmodules` — runs in every connected client.
- `serverEsmodules` — runs once in the Foundry Node process. v14 supports this; verify behavior matches docs at implementation time. (See "Server-side route registration" below.)
- `socket: true` — required to use the module socket channel.
- `compatibility.verified` should be the Foundry version we've actually tested against; bump per release.

## Initialization lifecycle

```js
// scripts/client.mjs
Hooks.once("init", () => {
  // Register settings, expose api skeleton.
  game.modules.get("foundry-voice-control").api = {};
});

Hooks.once("ready", () => {
  // World is loaded, canvas exists, sockets are ready.
  registerSocketHandler();
  if (game.user.isGM) announceClientReady();
});

Hooks.on("canvasReady", (canvas) => {
  // Re-attach anything that depends on the active scene's tokens.
});
```

The four useful client lifecycle hooks:

| Hook | When | Use for |
|------|------|---------|
| `init` | Earliest. No world loaded yet. | Register settings, declare hook handlers. |
| `i18nInit` | After language strings load. | Localize anything that used translation keys. |
| `setup` | Between `init` and `ready`. | Cross-module integration. |
| `ready` | World is fully loaded, user is logged in, sockets up. | Most module work. |

For the server-side script:

```js
// scripts/server.mjs
Hooks.once("ready", () => {
  // Register routes, start listening for socket dispatches.
});
```

## Scenes

```js
// Find
const sceneById   = game.scenes.get(id);
const sceneByName = game.scenes.getName("Bridge of Khazad-Dûm");
const active      = game.scenes.active;          // currently active scene
const viewed      = game.scenes.viewed;          // scene currently rendered (may differ on a player client)

// Activate (changes active scene for everyone)
await scene.activate();

// View only (renders for current user without activating)
await scene.view();

// List
for (const scene of game.scenes) { /* ... */ }

// Update fields
await scene.update({ name: "New name", "navigation.show": true });

// Create / delete
const created = await Scene.create({ name: "Test", grid: { type: 1, size: 100 } });
await scene.delete();
```

`scene.tokens` is a Collection of TokenDocument objects (the persisted records). The placed Token objects on the canvas are different — see Tokens below.

## Tokens

Tokens have a duality that's the source of many bugs:

- **TokenDocument** — the persisted record. Lives in `scene.tokens`. Mutated via `tokenDocument.update(...)`. Works on the server.
- **Token** — the canvas placeable (the visible shape on the map). Lives in `canvas.tokens.placeables`. Has a `.document` reference back to the TokenDocument. Most "live" operations (control, target, animate) go through the canvas Token. **Client-only.**

```js
// Find tokens on the active scene
const allDocs    = canvas.scene.tokens;                              // collection of docs
const allPlaced  = canvas.tokens.placeables;                          // canvas tokens
const byActorId  = canvas.tokens.placeables.filter(t => t.actor?.id === actorId);
const byName     = canvas.tokens.placeables.filter(t => t.name === "Goblin Boss");

// Place a token from an actor
const protoData = (await actor.getTokenDocument({ x: 1000, y: 1000 })).toObject();
const [tokenDoc] = await canvas.scene.createEmbeddedDocuments("Token", [protoData]);

// Update a placed token's image (this token only)
await tokenDoc.update({ "texture.src": "modules/foundry-voice-control/img/orc.webp" });

// Update prototype token on the actor (affects future placements)
await actor.update({ "prototypeToken.texture.src": "modules/foundry-voice-control/img/orc.webp" });

// Move a placed token
await tokenDoc.update({ x: 1500, y: 1500 });

// Delete tokens
await canvas.scene.deleteEmbeddedDocuments("Token", [tokenDoc.id, otherTokenDoc.id]);
```

Image path conventions: `modules/<id>/path` for module-bundled assets, `worlds/<id>/path` for world assets, or absolute URLs subject to the safety doc's allowlist.

## Selection and targeting

These are client-only — they manipulate canvas state, not document state.

```js
// What's currently selected / targeted
const selected = canvas.tokens.controlled;          // array of canvas Tokens
const targeted = Array.from(game.user.targets);     // Set → array

// Select tokens
token.control({ releaseOthers: true });             // select this, deselect others
token.control({ releaseOthers: false });            // additive
canvas.tokens.releaseAll();                         // clear selection

// Target tokens
token.setTarget(true,  { releaseOthers: true });    // target only this
token.setTarget(true,  { releaseOthers: false });   // add to targets
token.setTarget(false);                             // untarget
game.user.updateTokenTargets([]);                   // clear all targets

// Watching
Hooks.on("controlToken", (token, controlled) => { /* selection changed */ });
Hooks.on("targetToken",  (user, token, isTargeted) => { /* target changed */ });
```

`select_tokens` and `target_tokens` are the contract verbs that wrap these.

## Actors

```js
// Find
const actorById   = game.actors.get(id);
const actorByName = game.actors.getName("Bandit Boss");

// Search
const matches = game.actors.filter(a => a.name.toLowerCase().includes("gob"));

// Create
const actor = await Actor.create({
  name: "Goblin Boss",
  type: "npc",                       // must match a registered subtype
  img:  "modules/foundry-voice-control/img/goblin.webp",
  prototypeToken: { texture: { src: "modules/foundry-voice-control/img/goblin-token.webp" } },
  system: { /* system-specific; see references/systems/<id>.md */ },
  items:  [ /* embedded items, optional */ ],
});

// Update — dot-notation patches
await actor.update({
  "name": "Goblin Warlord",
  "system.attributes.hp.value": 22,
  "img": "modules/foundry-voice-control/img/goblin-warlord.webp",
});

// Update prototype token alongside actor
await actor.update({
  "img": "...",
  "prototypeToken.texture.src": "...",
});

// Delete
await actor.delete();
```

## Embedded items on an actor

```js
// Find
const item = actor.items.get(itemId);
const items = actor.items.filter(i => i.type === "weapon");

// Create
await actor.createEmbeddedDocuments("Item", [
  { name: "Greatsword", type: "weapon", system: { /* system-specific */ } },
]);

// Update
await actor.updateEmbeddedDocuments("Item", [
  { _id: item.id, "system.equipped": true },
]);

// Delete
await actor.deleteEmbeddedDocuments("Item", [item.id]);
```

The system-gated `add_item` / `remove_item` / `update_item` tools wrap these calls and validate the `system` payload against the active system's reference.

## Compendium access

```js
// List packs
for (const pack of game.packs) console.log(pack.metadata.id, pack.documentName);

// Find a specific pack
const pack = game.packs.get("dnd5e.monsters");

// Get a single document by id
const doc = await pack.getDocument(entryId);

// Get all documents in a pack (heavy — only when needed)
const docs = await pack.getDocuments();

// Search by name within a pack (uses pack index, fast)
const index = await pack.getIndex();
const entry = index.find(e => e.name === "Goblin");
const goblin = await pack.getDocument(entry._id);

// Import a compendium actor as a world actor
const imported = await actor.constructor.create(goblin.toObject(), { keepId: false });
```

`add_item` accepting a compendium reference uses `pack.getDocument(entryId)` plus the safety doc's pinning rules.

## Watching world state — important hooks

| Hook | Args | When |
|------|------|------|
| `createActor`, `updateActor`, `deleteActor` | `(doc, data, options, userId)` | Actor CRUD |
| `createItem`, `updateItem`, `deleteItem` | `(doc, data, options, userId)` | World-level item CRUD (rare) |
| `createToken`, `updateToken`, `deleteToken` | `(doc, data, options, userId)` | Token doc CRUD |
| `createScene`, `updateScene`, `deleteScene` | `(doc, data, options, userId)` | Scene CRUD |
| `controlToken` | `(token, controlled)` | Selection changes |
| `targetToken` | `(user, token, isTargeted)` | Target changes |
| `updateActiveEffect` | `(effect, data, options, userId)` | Status changes |
| `canvasReady` | `(canvas)` | Active scene changed |
| `ready` | `()` | Boot complete |
| `userConnected` | `(user, connected)` | User connect / disconnect |

`userConnected` is what the server-side dispatch uses to track whether a GM is currently connected.

## Module socket layer

For server↔client dispatch within our module.

```js
// Sender (either side)
game.socket.emit("module.foundry-voice-control", {
  requestId,
  tool: "select_tokens",
  params: { /* ... */ },
});

// Receiver (client)
game.socket.on("module.foundry-voice-control", (envelope) => {
  if (envelope.tool === "select_tokens") handleSelect(envelope);
});
```

Server-side equivalent uses `socket` from the Node side (exact import depends on Foundry's server module API for v14 — verify when implementing). Reply pattern uses the same channel with `{ requestId, ok, result, summary, error? }`.

For our module, the wrapper around `game.socket` should:

1. Generate a `requestId` (UUID).
2. Hold a `Promise` keyed by `requestId`.
3. Resolve when a reply with the matching `requestId` arrives.
4. Reject with `timeout` after the configured budget (default 5s per safety doc).

## Settings registration

```js
game.settings.register("foundry-voice-control", "ipAllowlist", {
  name: "IP allowlist",
  hint: "Comma-separated CIDRs. Empty = no restriction.",
  scope: "world",       // "world" = stored on server, GM-readable
                        // "client" = per-user, browser-local
  config: true,         // show in settings UI
  type: String,
  default: "",
});

const value = game.settings.get("foundry-voice-control", "ipAllowlist");
await game.settings.set("foundry-voice-control", "ipAllowlist", "10.0.0.0/8");
```

**Per safety doc, API key hashes do NOT live in module settings.** They live in a server-only JSON file (`<userData>/Data/modules/foundry-voice-control/keys.json`) outside `settings.db`. Module settings are used for non-sensitive config only.

## Server-side route registration

The server-side module file registers Express routes on Foundry's main HTTP server. The exact API surface for this in v14 needs to be verified against current Foundry server docs at implementation time — past versions exposed it via different lifecycle hooks. Two patterns to confirm:

```js
// Pattern A — direct app access via a setup hook
Hooks.once("setup", () => {
  const app = globalThis.express?.app;
  app?.post("/modules/foundry-voice-control/api/:tool", handleApiCall);
});

// Pattern B — Foundry's documented routes lifecycle
// (verify exact name and signature against v14 release notes)
```

Whatever the mechanism, the route handler runs in Node and has access to `game.actors`, `game.scenes`, etc. once the world is loaded. Pure data ops can complete server-side; ops needing canvas/UI must dispatch to a client via the socket layer.

## Canvas readiness and timing

Some calls fail silently if the canvas isn't ready yet. Defensive pattern:

```js
async function whenCanvasReady() {
  if (canvas.ready) return;
  return new Promise((resolve) => Hooks.once("canvasReady", resolve));
}

await whenCanvasReady();
canvas.tokens.controlled[0]?.control();
```

After `activate_scene`, wait for `canvasReady` before any client-side token op. The dispatch wrapper should bake this in.

## Image and portrait conventions

- **Actor portrait** — `actor.img`. Updated via `actor.update({ img: "..." })`.
- **Prototype token** — `actor.prototypeToken.texture.src`. Updated via `actor.update({ "prototypeToken.texture.src": "..." })`.
- **Placed token** — `tokenDoc.texture.src`. Updated via `tokenDoc.update({ "texture.src": "..." })`.

These are independent. The safety doc's `set_token_image` tool exposes a `scope` parameter (`"this_token" | "prototype" | "both"`) to control which gets updated.

## Common gotchas

1. **`game.scenes.active` vs `canvas.scene`.** Active is the world's current active scene; `canvas.scene` is what the *current user* is viewing. They differ when a player has navigated to a non-active scene.
2. **`Token` vs `TokenDocument`.** Always check whether you have the canvas placeable (has `.control`, `.document`) or the doc (has `.update`, `.parent`).
3. **`createEmbeddedDocuments` returns an array.** Even for a single doc, destructure the result: `const [item] = await actor.createEmbeddedDocuments("Item", [data])`.
4. **`actor.update` on `system.*` requires the system to define those paths.** Random `system.foo.bar` updates will silently no-op if the DataModel doesn't include `foo.bar`. Per-system reference enumerates valid paths.
5. **Patches don't merge arrays sensibly.** Replacing `system.skills` replaces the whole array. For partial array updates, read, modify, write the full array.
6. **Permissions.** Even with admin/GM, document operations still pass through permission checks. The server-side handler running as the Foundry process has full privileges; the client-side handler runs as the connected GM and inherits their ownership.
7. **Hooks fire on every client.** A `createActor` hook fires on every connected user's client. Use `if (userId !== game.user.id) return;` if you only want the originating client to react.
8. **`canvas.tokens` is `null` when no scene is active.** Guard with `if (!canvas.scene) return ...` for any token operation.
9. **`getName` returns the *first* match.** For ambiguous names, use `game.actors.filter(...)` and let the resolver disambiguate.
10. **`actor.update({ items: [...] })` does NOT update embedded items.** Use `actor.updateEmbeddedDocuments("Item", ...)`. The same goes for `tokens` on a scene, etc.
