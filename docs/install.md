# Installation

How to get Foundry Voice Control running on a dev Foundry v14 instance and ready to test. The companion `docs/quickstart.md` walks through smoke-testing every tool once install is done.

## Prerequisites

- **Foundry VTT v14** (current stable as of this writing). v13 may work for most tools but the module declares v14 in its manifest.
- **A Foundry world** running one of the supported game systems: `dnd5e`, `shadowdark`, or `whtow` (the WH:TOW system id is install-specific — see VERIFY notes).
- **GM access** to that world.
- **Internet-reachable Foundry** *or* a way to forward the route (ngrok / cloudflared / a reverse proxy). The module rides on Foundry's own web server — whatever URL you log into Foundry at is the same URL the module's API is exposed at.
- **TLS termination** somewhere in front of Foundry. The module rejects plain HTTP unless the request is from `127.0.0.1` / `::1`. (For pure-localhost dev that exemption is enough.)
- **Node.js 18+** is *not* required to run the module — Foundry already runs Node. It's only needed if you want to run the unit-test suite (`npm test`).
- **`curl` and (optionally) `jq`** for the smoke tests in `quickstart.md`.

## Step 1 — Drop the module into Foundry's user data

Find your Foundry user data directory. Default locations:

| OS | Path |
|----|------|
| Windows | `%LOCALAPPDATA%\FoundryVTT\Data` |
| macOS | `~/Library/Application Support/FoundryVTT/Data` |
| Linux | `~/.local/share/FoundryVTT/Data` |
| Forge | upload via the Bazaar (see "Forge note" below) |
| Self-hosted Docker | bind-mount `/data/Data` |

You can confirm the path from inside Foundry: **Setup → Configuration → User Data Path**.

Copy or symlink the project's `module/` directory into `<userData>/Data/modules/foundry-voice-control/`. The result should be:

```
<userData>/Data/modules/foundry-voice-control/
├── module.json
├── package.json          ← only used for tests; harmless in prod
├── lang/
├── styles/
└── scripts/
    ├── client.mjs
    ├── server.mjs
    └── …
```

For a development setup, **symlinking is recommended** so edits to the project repo show up live (after a Foundry restart):

```bash
# macOS / Linux
ln -s /path/to/foundry-voice-control/module ~/.local/share/FoundryVTT/Data/modules/foundry-voice-control
```

```powershell
# Windows (admin shell)
mklink /D "%LOCALAPPDATA%\FoundryVTT\Data\modules\foundry-voice-control" "C:\path\to\foundry-voice-control\module"
```

**Forge note:** The Forge Bazaar doesn't permit installing arbitrary modules. To install on Forge, zip the `module/` directory and upload as a custom module via **My Foundry → Bazaar → Modules → Custom**. You'll need to repeat the upload after every change.

## Step 2 — Restart Foundry

The module declares `serverEsmodules`. Foundry only loads server-side ES modules at process start — a hot-reload from the world's module config is **not** enough. Fully stop and start the Foundry server.

## Step 3 — Enable the module in your world

Launch the world. From the GM client:

1. **Settings → Manage Modules**.
2. Tick **Foundry Voice Control**.
3. **Save Module Settings**. Foundry will reload the world.

If the module fails to enable (Foundry shows a red error in the listing), check the Foundry server console output — usually it's a syntax error in `scripts/client.mjs` or `scripts/server.mjs`, or a missing file in `scripts/`.

## Step 4 — Verify the boot logs

This is the most important step on first install. The module logs every phase of boot. Open both the **Foundry server console** (the terminal or log file where Foundry's process writes) and the **GM browser DevTools console** (F12). Look for log lines prefixed with `foundry-voice-control`.

### What you should see (server console)

```
foundry-voice-control INFO {"msg":"Server init", …}
foundry-voice-control INFO {"msg":"Server setup"}
foundry-voice-control INFO {"msg":"Auth keys loaded","count":0}
foundry-voice-control INFO {"msg":"Audit log initialized", …}
foundry-voice-control INFO {"msg":"Socket integration ready","backend":"io"}
foundry-voice-control INFO {"msg":"Routes registered","base":"/modules/foundry-voice-control/api/"}
foundry-voice-control INFO {"msg":"System handler registered","system_id":"whtow"}
foundry-voice-control INFO {"msg":"System handler registered","system_id":"shadowdark"}
foundry-voice-control INFO {"msg":"System handler registered","system_id":"dnd5e"}
foundry-voice-control INFO {"msg":"Universal handlers registered, undo sweep started"}
foundry-voice-control INFO {"msg":"Server ready","boot_state":"ready", …}
```

### What you should see (GM browser console)

```
foundry-voice-control | client init (contract 0.1.0)
foundry-voice-control | client ready — user '<you>' (GM), system '…' v…, Foundry v14.… (gen 14)
foundry-voice-control | presence: online (GM <you>)
```

You should also see a one-time toast notification: **"Foundry Voice Control loaded (v0.1.0)."**

### What to do when boot logs are wrong

The module is built around five Foundry-version-specific integration points marked **VERIFY** in the source. If boot is wrong, one of them isn't matching. Diagnose by which log line is missing or in the wrong place.

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Server init` line appears in the **browser** console (not the server console) | `serverEsmodules` field name mismatch in `module.json` for v14 | Check Foundry v14 release notes for the correct manifest key; update `module.json` |
| `Could not locate Foundry's Express app` | `findExpressApp()` doesn't match v14 export | Edit `scripts/server/routes.mjs`'s `findExpressApp()` to match the actual global; in browser DevTools or via `console.log(globalThis)` find the Express `app` instance |
| `Could not locate Foundry's socket.io server` | `findSocketServer()` doesn't match v14 export | Edit `scripts/server/socket-integration.mjs`'s `findSocketServer()` similarly |
| `Auth keys loaded` line missing or path looks wrong | `globalThis.userData` not exposed in v14 | Edit `scripts/server/auth.mjs`'s `resolveKeysFilePath()` to match the actual user-data global |
| `presence: online` never appears in browser | Socket emit on the client isn't reaching the server | Cross-check `findSocketServer` and the room-name format in `socket-integration.mjs`'s `emitter` |

## Step 5 — Issue your first API key

From any chat input in Foundry (as GM):

```
/voice key new "test-operator" --scopes=operator
```

You'll see a private (whispered-to-self) chat message displaying the new key value:

```
Key issued — save this value now; it will not be shown again.
fvc_<43-character random string>
Id: key_<hex> · Label: test-operator · Scopes: read,scene,actor-write,roll
```

**Copy the `fvc_…` value immediately.** It's only shown once. If you lose it, revoke and reissue.

Other key-management commands you'll want eventually:

```
/voice key list                                  # see all keys (without values)
/voice key revoke <id>                           # disable one key
/voice key rotate <id> [--grace=5m]              # issue replacement
/voice revoke-all                                # panic — kills every key
/voice audit show [--last=20]                    # recent tool calls
/voice status                                    # module + system info
/voice help                                      # full command list
```

## Step 6 — Confirm the API surface is reachable

The module's HTTP routes live under `/modules/foundry-voice-control/api/<tool>`. Take whatever URL you use to access Foundry as a GM (e.g. `https://my-foundry.example.com`) and append the route base.

Quickest sanity check from the host with the key:

```bash
KEY="fvc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
HOST="https://my-foundry.example.com"

curl -sS \
  -X POST "$HOST/modules/foundry-voice-control/api/_health" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected response:

```json
{
  "ok": true,
  "summary": "Module is alive.",
  "data": {
    "contract_version": "0.1.0",
    "module_id": "foundry-voice-control",
    "server_time": "2026-…",
    "gm_connected": true,
    "connected_gms": [{"user_id":"…","user_name":"…","connected_at":"…"}]
  },
  "request_id": "…",
  "dispatched_to_client": false
}
```

If you get a 404 with no body, the most common cause is that **`findExpressApp()` failed** at boot. Re-read the server console; you should see a route-registration error.

If you get back a JSON envelope with `ok: false` and `error.code === "permission"`, the auth chain is working — the key just doesn't have the scope you're calling with. (`_health` uses `read`, which the operator preset includes.)

## Step 7 — Configure module settings (optional but recommended)

**Settings → Configure Settings → Module Settings → Foundry Voice Control.** Three knobs are exposed:

- **IP allowlist** (default empty) — comma-separated CIDRs that may call the API. Empty = no IP restriction. For internet-exposed Foundry, set this to your home IP / VPN range / Cloudflare's IP set.
- **Image URL allowlist** (default empty) — hosts whose URLs may be used in `set_token_image` / `set_actor_image`. Empty disables URL-based image fetching entirely (paths under user data still work).
- **Respect actor ownership** (default off) — when on, `find_actor` and `list_items` hide actors with restricted ownership for non-`gm`-scope keys. Off is the right default for personal play; on is useful if you ever issue a key for a player.

The rate-limit settings (per-minute caps for total / mutations / destructive ops) are stored but not exposed in the UI. To tune them at runtime, run in the GM browser console:

```js
await game.settings.set("foundry-voice-control", "rateLimitReqPerMin", 120);
```

## Step 8 — (Optional) Run the unit tests

If you have Node 18+ installed and want to confirm nothing's broken at the code level:

```bash
cd <where-you-cloned-the-project>/module
npm install
npm test
```

You should see `205 passed`. The tests don't touch Foundry — they exercise the pure-JS auth, validators, resolvers, etc.

## Common deployment shapes

### Local dev (recommended)

- Foundry running on `127.0.0.1:30000` on your dev machine.
- Module symlinked into user data per Step 1.
- TLS exempt by loopback rule — no cert needed.
- Test from the same machine with `curl http://127.0.0.1:30000/...`.
- This is the fastest setup for working through the VERIFY items.

### Self-hosted with reverse proxy (Caddy / nginx / Cloudflare Tunnel)

- Foundry behind a reverse proxy that handles TLS.
- Module routes accessible at `https://your-domain/modules/foundry-voice-control/api/...`.
- Set the IP allowlist to limit who can call.
- The reverse proxy must forward `Authorization` and `X-Forwarded-Proto: https` headers.
- Ensure your proxy doesn't strip the `Authorization` header for `/modules/*` paths.

### Forge

- Forge serves Foundry over its own TLS-terminated URL.
- Module installed via custom-module upload (no Bazaar entry).
- The module's HTTP routes ride on Forge's URL.
- `findExpressApp()` may need adjustment for Forge's wrapping — verify boot logs.
- Forge backups will preserve the module but **not** the keys file (which lives outside `settings.db` per design). Re-issue keys after a restore.

### ngrok / cloudflared tunnel

- Foundry on `127.0.0.1:30000`.
- Tunnel forwards `https://<random>.trycloudflare.com → 127.0.0.1:30000`.
- Set the URL allowlist to include the tunnel domain if you want to use it for `set_*_image` URLs.

## Uninstall / cleanup

To remove the module:

1. **Disable** in Manage Modules.
2. **Delete** the module folder from `<userData>/Data/modules/`.
3. **Optional:** delete `<userData>/Data/modules/foundry-voice-control/keys.json` and `audit.log` — but they're already inside the deleted module folder.

A pure disable (without delete) preserves keys and audit log; re-enabling restores all state.

## Troubleshooting reference

### Module won't enable

- Check Foundry's startup log for syntax errors in `scripts/`.
- Confirm `module.json`'s `id` is exactly `foundry-voice-control` and the file lives at `<userData>/Data/modules/foundry-voice-control/module.json`.

### `404` on every API call

- `findExpressApp()` failed. Look in the server console for the explicit error log:

  ```
  foundry-voice-control ERROR {"msg":"Could not locate Foundry's Express app — module routes NOT registered.", …}
  ```

  Edit the function to find the right global on your Foundry version.

### `gm_unavailable` on every dispatched call

- The GM hasn't announced presence. In the GM browser console:
  ```js
  game.modules.get("foundry-voice-control").api.contractVersion;  // sanity check the module is loaded
  ```
- If the GM is loaded but presence isn't reaching the server, `findSocketServer()` is wrong. Check the server console for `Could not locate Foundry's socket.io server`.

### `permission` on calls that should work

- Re-read the issued key's scopes via `/voice key list`.
- The operator preset includes `read+scene+actor-write+roll` — but **not** `gm`. Tools like `delete_actor` need `gm` scope.

### Plain-HTTP request rejected

- Either run on localhost (the loopback exemption applies), or put TLS in front of Foundry. The module deliberately won't accept non-loopback HTTP.

### Spam in the server console

- Logging level isn't currently configurable; the module logs INFO/WARN/ERROR. To suppress in production, redirect the Foundry process's stdout. Or filter in your log aggregator on the `foundry-voice-control` prefix.

## Next steps

Once the boot logs look healthy and `_health` returns `ok: true`, head to **`docs/quickstart.md`** for a step-by-step smoke test of every tool.
