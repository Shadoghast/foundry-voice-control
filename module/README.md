# Module Source

The Foundry module that backs Foundry Voice Control. Installed in a Foundry world; ships in two halves (server-side and client-side) per `docs/architecture.md`.

## Layout

```
module/
├── module.json                ← manifest
├── package.json               ← dev tooling (vitest, etc.)
├── lang/
│   └── en.json                ← i18n strings
├── styles/
│   └── foundry-voice-control.css    ← layered, minimal
├── scripts/
│   ├── client.mjs             ← client entry (browser, every connected user)
│   ├── server.mjs             ← server entry (Node, Foundry process)
│   ├── shared/                ← code used by both sides
│   │   └── constants.mjs
│   ├── server/                ← server-only code (auth, routes, dispatch)
│   ├── client/                ← client-only code (canvas, UI)
│   ├── handlers/              ← per-tool implementations
│   └── systems/               ← per-system handlers (dnd5e, shadowdark, whtow)
└── tests/                     ← vitest unit tests
```

## Build / install

For development, copy or symlink this directory into your Foundry user data
modules folder:

```
<userData>/Data/modules/foundry-voice-control/
```

Then enable it in the world's module list. v14 requires explicit enable per world.

## Running tests

```
cd module
npm install
npm test
```

## Status

Sub-stage 3a complete: installable empty shell that boots and logs.
Subsequent sub-stages add infrastructure, dispatch, handlers, system support,
chat commands, and the unit-test suite. See top-level `CLAUDE.md` for the
project map and stage tracker.
