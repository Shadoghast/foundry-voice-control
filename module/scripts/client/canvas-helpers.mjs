/**
 * Foundry Voice Control — client-side canvas helpers.
 *
 * Small utilities used by client tool handlers. Keep this file thin; logic
 * for individual tools lives next to those tools.
 */

/**
 * Resolve once the canvas has finished rendering. Some calls fail silently
 * if the canvas isn't ready — most token-related ops in particular.
 */
export function whenCanvasReady() {
  if (canvas?.ready) return Promise.resolve();
  return new Promise((resolve) => {
    Hooks.once("canvasReady", () => resolve());
  });
}

/** Find tokens on the active scene matching a given id-or-name. */
export function listActiveTokens() {
  if (!canvas?.tokens) return [];
  return canvas.tokens.placeables.map((t) => ({
    id: t.id,
    name: t.name,
    actor_name: t.actor?.name ?? null,
    token: t,
  }));
}

/** Listing for the resolver — tokens by token-name first, then actor-name fallback. */
export function tokenResolverItems() {
  return listActiveTokens().flatMap((t) =>
    t.actor_name && t.actor_name !== t.name
      ? [
          { id: t.id, name: t.name, _token: t.token },
          { id: t.id, name: t.actor_name, _token: t.token },
        ]
      : [{ id: t.id, name: t.name, _token: t.token }],
  );
}
