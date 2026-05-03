/**
 * Foundry Voice Control — chat commands.
 *
 * Intercepts `/voice ...` chat input from the GM client and routes to
 * the server-side admin handler over the module socket. Replies are
 * rendered as private (whispered-to-self) chat messages so secrets like
 * a freshly-issued API key don't appear in other users' chat windows.
 *
 * Available commands:
 *   /voice help
 *   /voice status
 *   /voice key new <label> [--scopes=preset|csv] [--expires=30d]
 *   /voice key list
 *   /voice key revoke <id>
 *   /voice key rotate <id> [--grace=5m]
 *   /voice revoke-all
 *   /voice audit show [--last=20]
 *
 * Only GMs can invoke commands; non-GMs see a one-line refusal.
 */

import { adminRpc } from "./admin-rpc.mjs";
import { MODULE_TITLE } from "../shared/constants.mjs";

let installed = false;

/** Wire the chat command interception. Idempotent. */
export function initChatCommands() {
  if (installed) return;
  installed = true;

  // Match `/voice` followed by end-of-string OR whitespace — NOT
  // `/voicekey` or `/voice-stuff`.
  const PREFIX_RE = /^\/voice(\s|$)/i;

  // v13+ rewrote chat input into a ProseMirror plugin whose slash-command
  // parser rejects unrecognized commands before the `chatMessage` hook
  // fires — so returning false from that hook can't suppress the
  // "is not a valid chat message command" error. Wrap processMessage so
  // /voice is claimed before Foundry's parser runs.
  const ChatLogClass =
    foundry?.applications?.sidebar?.tabs?.ChatLog ?? globalThis.ChatLog;
  if (!ChatLogClass?.prototype?.processMessage) {
    console.error(
      `${MODULE_TITLE} | could not locate ChatLog.processMessage; /voice commands will not work`,
    );
    return;
  }

  const originalProcess = ChatLogClass.prototype.processMessage;
  ChatLogClass.prototype.processMessage = function (message, ...rest) {
    const text = extractCommandText(message);
    if (!PREFIX_RE.test(text)) {
      return originalProcess.call(this, message, ...rest);
    }
    if (!game.user?.isGM) {
      ui.notifications?.warn(`${MODULE_TITLE} commands require GM access.`);
      return Promise.resolve(null);
    }
    handleCommand(text).catch((err) =>
      postPrivate(`Command failed: ${escapeHtml(err.message ?? String(err))}`).catch(
        (postErr) =>
          console.error(`${MODULE_TITLE} | failed to post error chat`, postErr),
      ),
    );
    return Promise.resolve(null);
  };
}

// ProseMirror wraps chat input in `<p>...</p>` before handing it to
// processMessage. Strip the wrapper (and decode entities like `&quot;`)
// so the command parser sees the user's literal text.
function extractCommandText(message) {
  const raw = String(message ?? "").trim();
  if (!raw.startsWith("<")) return raw;
  const tmp = document.createElement("div");
  tmp.innerHTML = raw;
  return (tmp.textContent ?? "").trim();
}

async function handleCommand(text) {
  const rest = text.slice("/voice".length).trim();
  if (rest === "" || /^help$/i.test(rest)) return helpCommand();

  // Tokenize.
  const tokens = tokenize(rest);
  const head = (tokens[0] ?? "").toLowerCase();

  if (head === "status") return statusCommand();
  if (head === "revoke-all") return revokeAllCommand();

  if (head === "key") {
    const sub = (tokens[1] ?? "").toLowerCase();
    const tail = tokens.slice(2);
    if (sub === "new") return keyNewCommand(tail);
    if (sub === "list") return keyListCommand();
    if (sub === "revoke") return keyRevokeCommand(tail);
    if (sub === "rotate") return keyRotateCommand(tail);
    return postPrivate(`Unknown subcommand <code>key ${escapeHtml(sub)}</code>. Try <code>/voice help</code>.`);
  }

  if (head === "audit") {
    const sub = (tokens[1] ?? "").toLowerCase();
    const tail = tokens.slice(2);
    if (sub === "show") return auditShowCommand(tail);
    return postPrivate(`Unknown subcommand <code>audit ${escapeHtml(sub)}</code>. Try <code>/voice help</code>.`);
  }

  return postPrivate(`Unknown command <code>${escapeHtml(head)}</code>. Try <code>/voice help</code>.`);
}

// ---------- commands ----------

async function helpCommand() {
  const lines = [
    `<strong>${escapeHtml(MODULE_TITLE)} commands</strong>`,
    `<code>/voice status</code> &mdash; module health`,
    `<code>/voice key new &lt;label&gt; [--scopes=preset|csv] [--expires=30d]</code>`,
    `<code>/voice key list</code>`,
    `<code>/voice key revoke &lt;id&gt;</code>`,
    `<code>/voice key rotate &lt;id&gt; [--grace=5m]</code>`,
    `<code>/voice revoke-all</code> &mdash; panic; revokes every key`,
    `<code>/voice audit show [--last=20]</code>`,
    `<em>Scope presets: operator, readonly, gm.</em>`,
  ];
  return postPrivate(lines.join("<br>"));
}

async function statusCommand() {
  const reply = await adminRpc("status");
  const lines = [
    `<strong>Status</strong>`,
    `Module: <code>${escapeHtml(reply.module_id)}</code> v<code>${escapeHtml(reply.contract_version)}</code>`,
    `Active system: <code>${escapeHtml(reply.active_system ?? "(unknown)")}</code>` +
      (reply.active_system_version ? ` v<code>${escapeHtml(reply.active_system_version)}</code>` : ""),
    `Supported systems: <code>${escapeHtml((reply.supported_systems ?? []).join(", ") || "(none)")}</code>`,
  ];
  return postPrivate(lines.join("<br>"));
}

async function keyNewCommand(tail) {
  const { positional, flags } = parseFlags(tail);
  const label = positional.join(" ").trim();
  if (!label) {
    return postPrivate(`Usage: <code>/voice key new &lt;label&gt; [--scopes=...] [--expires=30d]</code>`);
  }
  const reply = await adminRpc("key:new", {
    label,
    scopes: flags.scopes,
    expires: flags.expires,
  });
  const meta = reply.metadata ?? {};
  const lines = [
    `<strong>Key issued</strong> &mdash; <em>save this value now; it will not be shown again.</em>`,
    `<code>${escapeHtml(reply.raw_value)}</code>`,
    `<small>Id: <code>${escapeHtml(meta.id ?? "?")}</code> &middot; ` +
      `Label: <code>${escapeHtml(meta.label ?? "?")}</code> &middot; ` +
      `Scopes: <code>${escapeHtml((meta.scopes ?? []).join(", "))}</code>` +
      (meta.expires_at ? ` &middot; Expires: <code>${escapeHtml(meta.expires_at)}</code>` : "") +
      `</small>`,
  ];
  return postPrivate(lines.join("<br>"));
}

async function keyListCommand() {
  const reply = await adminRpc("key:list");
  const keys = reply.keys ?? [];
  if (keys.length === 0) {
    return postPrivate(`<em>No keys issued yet.</em>`);
  }
  const rows = keys
    .map((k) => {
      const status = k.revoked_at
        ? `<span style="color:#c33">revoked ${formatDate(k.revoked_at)}</span>`
        : k.expires_at && new Date(k.expires_at).getTime() < Date.now()
          ? `<span style="color:#c33">expired</span>`
          : `<span style="color:#383">active</span>`;
      return `<tr><td><code>${escapeHtml(k.id)}</code></td>` +
        `<td>${escapeHtml(k.label)}</td>` +
        `<td><code>${escapeHtml((k.scopes ?? []).join(","))}</code></td>` +
        `<td>${status}</td>` +
        `<td><small>${escapeHtml(k.last_used_at ?? "—")}</small></td></tr>`;
    })
    .join("");
  return postPrivate(
    `<strong>Keys (${keys.length})</strong><br>` +
      `<table style="font-size:90%"><thead><tr><th>id</th><th>label</th><th>scopes</th><th>status</th><th>last used</th></tr></thead><tbody>${rows}</tbody></table>`,
  );
}

async function keyRevokeCommand(tail) {
  const id = (tail[0] ?? "").trim();
  if (!id) {
    return postPrivate(`Usage: <code>/voice key revoke &lt;id&gt;</code>`);
  }
  await adminRpc("key:revoke", { id });
  return postPrivate(`Revoked key <code>${escapeHtml(id)}</code>.`);
}

async function keyRotateCommand(tail) {
  const { positional, flags } = parseFlags(tail);
  const id = (positional[0] ?? "").trim();
  if (!id) {
    return postPrivate(`Usage: <code>/voice key rotate &lt;id&gt; [--grace=5m]</code>`);
  }
  const reply = await adminRpc("key:rotate", { id, grace: flags.grace });
  const meta = reply.metadata ?? {};
  const grace = reply.grace_ms != null ? `${Math.round(reply.grace_ms / 1000)}s` : "5m";
  return postPrivate(
    `<strong>Key rotated</strong> &mdash; old key (<code>${escapeHtml(reply.old_id)}</code>) revokes in ${grace}.<br>` +
      `New value: <code>${escapeHtml(reply.raw_value)}</code><br>` +
      `<small>New id: <code>${escapeHtml(meta.id ?? "?")}</code></small>`,
  );
}

async function revokeAllCommand() {
  const ok = await confirmDialog(
    "Revoke ALL keys?",
    "This will disable every active API key. Active sessions will break immediately.",
    "Revoke all",
  );
  if (!ok) {
    return postPrivate(`<em>Cancelled.</em>`);
  }
  const reply = await adminRpc("revoke-all");
  return postPrivate(`<strong>Revoked ${reply.revoked} key(s).</strong>`);
}

async function auditShowCommand(tail) {
  const { flags } = parseFlags(tail);
  const reply = await adminRpc("audit:show", { last: flags.last });
  const entries = reply.entries ?? [];
  if (entries.length === 0) {
    return postPrivate(`<em>No audit entries.</em>`);
  }
  const rows = entries
    .map((e) => {
      const ok = e.success ? "✓" : "✗";
      return `<tr><td><small>${escapeHtml(e.timestamp ?? "")}</small></td>` +
        `<td>${ok}</td>` +
        `<td><code>${escapeHtml(e.tool ?? "")}</code></td>` +
        `<td><code>${escapeHtml(e.scope_used ?? "")}</code></td>` +
        `<td><small>${escapeHtml(e.key_id ?? "")}</small></td>` +
        `<td><small>${escapeHtml(e.source_ip ?? "")}</small></td></tr>`;
    })
    .join("");
  return postPrivate(
    `<strong>Last ${entries.length} audit entries</strong><br>` +
      `<table style="font-size:80%"><thead><tr><th>time</th><th></th><th>tool</th><th>scope</th><th>key</th><th>ip</th></tr></thead><tbody>${rows}</tbody></table>`,
  );
}

// ---------- helpers ----------

function tokenize(input) {
  // Simple shell-style: respect double-quoted spans, treat --flag=value as one token.
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(input)) !== null) {
    out.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return out;
}

function parseFlags(tokens) {
  const positional = [];
  const flags = {};
  for (const t of tokens) {
    if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      if (eq > 0) flags[t.slice(2, eq)] = t.slice(eq + 1);
      else flags[t.slice(2)] = true;
    } else {
      positional.push(t);
    }
  }
  return { positional, flags };
}

async function postPrivate(html) {
  const speaker = { alias: MODULE_TITLE };
  await ChatMessage.create({
    user: game.user.id,
    whisper: [game.user.id],
    speaker,
    content: html,
  });
}

async function confirmDialog(title, body, yesLabel) {
  // Foundry v14 DialogV2 confirm.
  const Dialog = foundry?.applications?.api?.DialogV2;
  if (!Dialog?.confirm) {
    // Fallback: just confirm with window.confirm if v2 not available.
    return window.confirm(`${title}\n\n${body}`);
  }
  return await Dialog.confirm({
    window: { title },
    content: `<p>${escapeHtml(body)}</p>`,
    yes: { label: yesLabel ?? "Confirm" },
    no: { label: "Cancel" },
  });
}

function formatDate(s) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
