# Publishing to GitHub

How to push the project to a GitHub repo and cut a release that end users can install via Foundry's "paste-the-manifest-URL" install flow. This is a one-time setup; once it's running, future releases are `bump version → tag → push → publish` (~5 minutes).

## One-time setup

### 1. Create the GitHub repo

Web UI: <https://github.com/new>

- **Name**: `foundry-voice-control`
- **Visibility**: public (required for the manifest URL to be reachable without auth).
- **Skip** Initialize with README / .gitignore / LICENSE — we have all three already.

Or with the GitHub CLI:

```bash
gh repo create foundry-voice-control --public --description "Voice-controlled operation of Foundry VTT — MCP module for Foundry v14"
```

### 2. Push the project

From the project root:

```bash
cd /path/to/foundry-voice-control
git init
git add .
git commit -m "Initial commit: Foundry Voice Control v0.1.0"
git branch -M main
git remote add origin https://github.com/<your-username>/foundry-voice-control.git
git push -u origin main
```

### 3. Update `module.json` with real URLs

Edit `module/module.json`. Replace the three `https://example.com/...` placeholders with your real GitHub URLs — using the **/latest/download/** alias on the manifest URL means users always get the most recent release without you needing to update the manifest URL itself.

```jsonc
{
  …
  "url": "https://github.com/<your-username>/foundry-voice-control",
  "manifest": "https://github.com/<your-username>/foundry-voice-control/releases/latest/download/module.json",
  "download": "https://github.com/<your-username>/foundry-voice-control/releases/download/v0.1.0/foundry-voice-control-0.1.0.zip"
}
```

The `download` URL is version-specific (note `v0.1.0` and `0.1.0` in the path) — bump it on each release. The `manifest` URL stays the same forever.

Commit and push:

```bash
git add module/module.json
git commit -m "Set release URLs"
git push
```

### 4. Verify CI runs

The `.github/workflows/test.yml` workflow runs `npm test` on Node 20 and 22 on every push to `main` and on every PR. Open <https://github.com/your-username/foundry-voice-control/actions> to confirm the green check after pushing.

## Cutting a release

Repeat for every version bump.

### 1. Bump the version

In `module/module.json` and `module/package.json`, change `"version"` to the new value (e.g., `0.1.1`, `0.2.0`, `1.0.0` — semver: patch / minor / major).

Also bump the `download` URL in `module.json` to point at the new version:

```jsonc
"download": "https://github.com/<your-username>/foundry-voice-control/releases/download/v0.2.0/foundry-voice-control-0.2.0.zip"
```

### 2. Build the release zip

From the project root:

```bash
./scripts/build-release.sh
```

This produces:

- `release/foundry-voice-control-<version>.zip` — the module bundle (excludes `node_modules`, `tests/`, dev configs).
- `release/module.json` — a standalone copy of the manifest.

The script reads the version from `module.json` automatically. You can override with `./scripts/build-release.sh 0.2.0`.

### 3. Tag and push

```bash
git add module/module.json module/package.json
git commit -m "Release v0.2.0"
git tag v0.2.0
git push && git push --tags
```

### 4. Create the GitHub Release

Web UI: <https://github.com/your-username/foundry-voice-control/releases/new>

- **Choose a tag**: `v0.2.0` (the one you just pushed).
- **Release title**: `v0.2.0`.
- **Description**: changelog notes — what changed since the previous release.
- **Attach files**:
  - `release/foundry-voice-control-0.2.0.zip`
  - `release/module.json`

Click **Publish release**.

Or with the GitHub CLI:

```bash
gh release create v0.2.0 \
  --title "v0.2.0" \
  --notes "Brief changelog here" \
  release/foundry-voice-control-0.2.0.zip \
  release/module.json
```

### 5. Sanity-check the manifest URL

```bash
curl -sSL -o /tmp/check.json \
  https://github.com/<your-username>/foundry-voice-control/releases/latest/download/module.json
cat /tmp/check.json | grep version
# Should show the version you just released
```

Foundry will pull from `releases/latest/download/module.json` going forward and detect the new version automatically.

## What end users do

Once a release is up, end users install via the Foundry GUI:

1. **Setup → Add-on Modules → Install Module**.
2. Paste into the Manifest URL field at the bottom:
   ```
   https://github.com/<your-username>/foundry-voice-control/releases/latest/download/module.json
   ```
3. Click **Install**.
4. Enable in the world: **Settings → Manage Modules → Foundry Voice Control → Save**.
5. Restart Foundry once.
6. Issue a key in chat: `/voice key new "operator" --scopes=operator`.

For the full smoke test against a fresh install, point them at `docs/quickstart.md`.

## Updating later

Foundry checks the manifest URL periodically and on world load. When users see a newer version available, they click **Update** in the modules list — Foundry re-downloads and re-installs in place. No action required from them beyond clicking the button.

To roll out an update:

1. Bump version in both `module.json` files (project root and module/).
2. Update the `download` URL.
3. Run `./scripts/build-release.sh`.
4. Tag, push, create the GitHub release, attach the new zip + module.json.

## Versioning convention

Follow [semver](https://semver.org/):

- **Patch** (`0.1.0 → 0.1.1`) — bug fixes, no API changes.
- **Minor** (`0.1.0 → 0.2.0`) — new tools, new system handlers, additive contract changes.
- **Major** (`0.1.0 → 1.0.0`) — breaking response-shape changes, incompatible scope renames, removed tools.

The `contract_version` constant in `scripts/shared/constants.mjs` should track the same value — Claude reads it via `get_world_state` to detect drift.

## Foundry's official package list (optional)

Once the module is stable and you want broader visibility, you can submit it to <https://foundryvtt.com/packages>. Submission is a one-time form; Foundry's review process can take a week or two. Most personal-use modules skip this and just rely on the manifest URL — it's perfectly fine.

Forge users can install via the same manifest URL through Forge's custom-module path (no Bazaar listing required).

## Common gotchas

- **The zip's top-level must be `module.json`, not a `module/` subdirectory.** Foundry extracts the zip directly into `<userData>/Data/modules/foundry-voice-control/`. The `build-release.sh` script handles this correctly.
- **`download` URL is version-pinned, not /latest.** Foundry uses `download` to fetch the actual zip, and a `/latest` URL would behave unpredictably across version bumps. Always bump the version in `download` when you bump the version in the manifest.
- **The module's own routes don't change at install time.** They're always `/modules/foundry-voice-control/api/<tool>` (the module ID, not the version). End users' MCP configs work across upgrades without changes.
- **`npm test` failures block the release** if you've configured branch protection. Worth setting up — keeps green-CI honest.
- **Don't commit `keys.json` or `audit.log`.** They're in `.gitignore` already, but if you've been testing locally and they're in `<userData>/Data/modules/foundry-voice-control/`, they're outside the repo so you're fine. The defensive `.gitignore` entries cover the case where someone clones the project into a Foundry user-data path by mistake.
