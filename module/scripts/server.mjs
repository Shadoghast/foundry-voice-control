/**
 * Foundry Voice Control — server entry point.
 *
 * Runs once in the Foundry Node.js process. Owns the public HTTP/MCP surface,
 * authenticates Claude, and dispatches to the connected GM client over the
 * module socket layer when canvas/UI access is required.
 * See docs/architecture.md.
 *
 * VERIFY: This file is registered via `serverEsmodules` in module.json. v14
 * supports server-side module ES modules; if this banner appears in the
 * BROWSER console, the manifest field name is wrong for v14.
 */

import * as nodePath from "node:path";

import { CONTRACT_VERSION, MODULE_ID } from "./shared/constants.mjs";
import { logger } from "./server/logger.mjs";
import { registerSettings } from "./server/settings.mjs";
import { loadKeys, resolveKeysFilePath } from "./server/auth.mjs";
import { initAuditLog } from "./server/audit-log.mjs";
import { registerRoutes } from "./server/routes.mjs";
import { initSocketIntegration, isReady as socketReady } from "./server/socket-integration.mjs";
import { initDispatcher } from "./server/dispatcher.mjs";
import { registerAllServerHandlers } from "./server/handlers/index.mjs";
import { startSweep as startUndoSweep } from "./server/undo-store.mjs";
import { registerAllServerSystems } from "./server/systems/index.mjs";

/** Track boot state so requests during init return 503, not unauth. */
let bootState = "starting";

Hooks.once("init", () => {
  logger.info({ msg: "Server init", contract_version: CONTRACT_VERSION });
  // Settings register here so they're available to server code that runs
  // before any client connects.
  try {
    registerSettings();
  } catch (err) {
    logger.error({ msg: "Settings registration failed", err });
  }
});

Hooks.once("setup", async () => {
  logger.info({ msg: "Server setup" });

  try {
    // Load auth keys file (creates if missing).
    await loadKeys();

    // Audit log lives next to keys.json under <userData>/Data/modules/...
    const keysPath = resolveKeysFilePath();
    const userDataPath = nodePath.dirname(nodePath.dirname(nodePath.dirname(nodePath.dirname(keysPath))));
    await initAuditLog(userDataPath);
  } catch (err) {
    logger.error({ msg: "Setup phase failed", err });
    bootState = "failed";
    return;
  }

  // Wire the socket layer FIRST so the dispatcher and presence tracker are
  // ready before any HTTP request can land.
  const socketOk = initSocketIntegration();
  if (socketOk) {
    initDispatcher();
  }

  // Register routes. If this fails, the module is effectively a no-op until
  // findExpressApp() is fixed for v14.
  const routesOk = registerRoutes();
  if (!routesOk) {
    bootState = "no-routes";
  } else if (!socketOk) {
    bootState = "no-socket"; // routes work, but server-to-client dispatch will fail
  } else {
    bootState = "ready";
  }
});

Hooks.once("ready", () => {
  // World is loaded; register the universal tool handlers now that
  // game.scenes / game.actors / game.system are accessible. Stubs from
  // routes.mjs already registered earlier in `setup`.
  try {
    // Register system handlers BEFORE universal handlers — actor/item
    // handlers consult the registry on each call, so the registry must
    // be populated when they boot.
    registerAllServerSystems();
    registerAllServerHandlers();
    startUndoSweep();
    logger.info({ msg: "Systems + handlers registered, undo sweep started" });
  } catch (err) {
    logger.error({ msg: "Failed to register universal handlers", err });
    bootState = "handlers-failed";
  }

  logger.info({
    msg: "Server ready",
    boot_state: bootState,
    system: globalThis.game?.system?.id ?? "unknown",
    system_version: globalThis.game?.system?.version ?? "unknown",
  });
});

/** Used by health checks and tests. */
export function getBootState() {
  return bootState;
}
