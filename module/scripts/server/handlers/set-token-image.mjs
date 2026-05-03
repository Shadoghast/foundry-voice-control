/**
 * Foundry Voice Control — set_token_image handler (server-side).
 *
 * Universal data update; canvas auto-refreshes when a TokenDocument's
 * texture.src changes. Three scopes:
 *   - this_token  — update only the placed Token's texture
 *   - prototype   — update the actor's prototype token (future placements)
 *   - both        — both
 */

import * as nodePath from "node:path";

import { ValidationError } from "../../shared/errors.mjs";
import { resolveByIdOrName } from "../../shared/resolver.mjs";
import { SCOPES, requireScope, resolveKeysFilePath } from "../auth.mjs";
import { registerTool } from "../routes.mjs";
import { validateImageInput } from "../image-validation.mjs";
import { recordUndo } from "../undo-store.mjs";

const VALID_SCOPES = new Set(["this_token", "prototype", "both"]);

export function registerSetTokenImageHandler() {
  registerTool("set_token_image", {
    scope: SCOPES.ACTOR_WRITE,
    kind: "mutation",
    requireScope: (scopes) => requireScope(scopes, SCOPES.ACTOR_WRITE),
    async handler({ params, ctx }) {
      if (params.token == null) {
        throw new ValidationError("Missing required parameter 'token'.", { field: "token" });
      }
      if (params.image == null) {
        throw new ValidationError("Missing required parameter 'image'.", { field: "image" });
      }

      const scope = params.scope ?? "this_token";
      if (!VALID_SCOPES.has(scope)) {
        throw new ValidationError(`Unknown scope '${scope}'.`, {
          field: "scope",
          valid: [...VALID_SCOPES],
        });
      }

      const userDataPath = nodePath.dirname(
        nodePath.dirname(nodePath.dirname(nodePath.dirname(resolveKeysFilePath()))),
      );
      const validated = await validateImageInput(String(params.image), userDataPath);

      // Resolve the token via the active scene's TokenDocuments.
      const activeScene = game.scenes.active;
      if (!activeScene) {
        throw new ValidationError("No active scene; cannot resolve token.");
      }
      const tokenDocs = Array.from(activeScene.tokens.values()).flatMap((td) => {
        // Allow resolution by token name OR underlying actor name.
        const entries = [{ id: td.id, name: td.name, doc: td }];
        if (td.actor?.name && td.actor.name !== td.name) {
          entries.push({ id: td.id, name: td.actor.name, doc: td });
        }
        return entries;
      });

      const { match } = resolveByIdOrName({
        items: tokenDocs,
        query: String(params.token),
        kind: "token",
      });
      const tokenDoc = match.doc;
      const actor = tokenDoc.actor;

      const previousThis = tokenDoc.texture?.src;
      const previousProto = actor?.prototypeToken?.texture?.src;

      if (scope === "this_token" || scope === "both") {
        await tokenDoc.update({ "texture.src": validated.value });
      }
      if ((scope === "prototype" || scope === "both") && actor) {
        await actor.update({ "prototypeToken.texture.src": validated.value });
      }

      const undoToken = recordUndo(ctx, {
        tool: "set_token_image",
        scopeRequired: SCOPES.ACTOR_WRITE,
        clientRequired: false,
        payload: {
          type: "set_token_image",
          scene_id: activeScene.id,
          token_id: tokenDoc.id,
          actor_id: actor?.id ?? null,
          scope_applied: scope,
          previous_image_this_token:
            scope === "this_token" || scope === "both" ? previousThis : undefined,
          previous_image_prototype:
            scope === "prototype" || scope === "both" ? previousProto : undefined,
        },
      });

      return {
        summary: `Updated ${scope === "both" ? "both " : ""}image for ${tokenDoc.name}.`,
        data: {
          token_id: tokenDoc.id,
          actor_id: actor?.id ?? null,
          scope_applied: scope,
          previous_image_this_token: previousThis,
          previous_image_prototype: scope === "prototype" || scope === "both" ? previousProto : undefined,
          new_image: validated.value,
          undo_token: undoToken,
        },
        warnings: validated.warnings,
      };
    },
  });
}
