/**
 * Foundry Voice Control — settings registration.
 *
 * Registers the non-sensitive runtime config in `game.settings`. API key
 * material does NOT live here — see auth.mjs and the keys.json file.
 *
 * VERIFY: settings registration on the server side (during the `init` hook)
 * works the same as on the client in v14. If only client-side registrations
 * persist, move this to client.mjs and read via socket from server.mjs.
 */

import { MODULE_ID } from "../shared/constants.mjs";

export const SETTING_KEYS = Object.freeze({
  IP_ALLOWLIST: "ipAllowlist",
  URL_ALLOWLIST: "urlAllowlist",
  RESPECT_OWNERSHIP: "respectOwnership",
  RATE_LIMIT_REQ_PER_MIN: "rateLimitReqPerMin",
  RATE_LIMIT_MUTATIONS_PER_MIN: "rateLimitMutationsPerMin",
  RATE_LIMIT_DESTRUCTIVE_PER_MIN: "rateLimitDestructivePerMin",
  AUDIT_LOG_RETENTION_DAYS: "auditLogRetentionDays",
});

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTING_KEYS.IP_ALLOWLIST, {
    name: "FOUNDRY_VOICE_CONTROL.IpAllowlist.Name",
    hint: "FOUNDRY_VOICE_CONTROL.IpAllowlist.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.URL_ALLOWLIST, {
    name: "FOUNDRY_VOICE_CONTROL.UrlAllowlist.Name",
    hint: "FOUNDRY_VOICE_CONTROL.UrlAllowlist.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.RESPECT_OWNERSHIP, {
    name: "FOUNDRY_VOICE_CONTROL.RespectOwnership.Name",
    hint: "FOUNDRY_VOICE_CONTROL.RespectOwnership.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.RATE_LIMIT_REQ_PER_MIN, {
    scope: "world",
    config: false, // hidden — tuned by power users via console
    type: Number,
    default: 60,
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.RATE_LIMIT_MUTATIONS_PER_MIN, {
    scope: "world",
    config: false,
    type: Number,
    default: 10,
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.RATE_LIMIT_DESTRUCTIVE_PER_MIN, {
    scope: "world",
    config: false,
    type: Number,
    default: 5,
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.AUDIT_LOG_RETENTION_DAYS, {
    scope: "world",
    config: false,
    type: Number,
    default: 7,
  });
}

/** Convenience reader. Returns the parsed value (split arrays for *Allowlist). */
export function getSetting(key) {
  const raw = game.settings.get(MODULE_ID, key);
  if (key === SETTING_KEYS.IP_ALLOWLIST || key === SETTING_KEYS.URL_ALLOWLIST) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return raw;
}
