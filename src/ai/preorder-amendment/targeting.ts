import { z } from "zod";

import type { AiBusinessModelContextV1 } from "../context/schemas";
import { graphKeySchema } from "../../core/graph/schemas";

export const preorderTargetScopeSchema = z
  .object({
    preorder_key: graphKeySchema,
    selection: z.enum(["sole_active", "explicit_request"]),
  })
  .strict();

export type PreorderTargetScope = z.infer<typeof preorderTargetScopeSchema>;

export type PreorderTargetResolution =
  | { state: "selected"; scope: PreorderTargetScope }
  | { state: "ambiguous" }
  | { state: "unknown" };

const explicitPreorderKeyPattern =
  /\bpreorder_key\s*[:=]\s*[`'"]?([^\s,.;!?)}\]]+)[`'"]?/gi;

function exactKeyToken(request: string, key: string): boolean {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9_])${escaped}(?=$|[^a-z0-9_])`).test(request);
}

function explicitKeys(request: string): { values: string[]; invalid: boolean } {
  const values: string[] = [];
  let invalid = false;
  for (const match of request.matchAll(explicitPreorderKeyPattern)) {
    const value = match[1]?.trim();
    if (!value || !graphKeySchema.safeParse(value).success) {
      invalid = true;
      continue;
    }
    values.push(value);
  }
  return { values, invalid };
}

export function resolvePreorderTarget(
  context: Pick<AiBusinessModelContextV1, "preorder_experiences">,
  ownerRequest: string,
): PreorderTargetResolution {
  const experiences = context.preorder_experiences;
  const active = experiences.filter(({ is_active }) => is_active);
  const explicit = explicitKeys(ownerRequest);
  const explicitUnique = [...new Set(explicit.values)];

  if (explicit.invalid || explicitUnique.length > 1) {
    return { state: explicit.invalid ? "unknown" : "ambiguous" };
  }

  if (explicitUnique.length === 1) {
    const [preorderKey] = explicitUnique;
    const matches = experiences.filter(({ key }) => key === preorderKey);
    if (matches.length !== 1 || !matches[0]?.is_active) {
      return { state: "unknown" };
    }
    return {
      state: "selected",
      scope: {
        preorder_key: preorderKey!,
        selection: "explicit_request",
      },
    };
  }

  if (active.length === 1) {
    const soleKey = active[0]!.key;
    if (experiences.filter(({ key }) => key === soleKey).length !== 1) {
      return { state: "unknown" };
    }
    return {
      state: "selected",
      scope: {
        preorder_key: soleKey,
        selection: "sole_active",
      },
    };
  }

  if (active.length === 0) {
    return { state: "unknown" };
  }

  const exactActiveMatches = active.filter(({ key }) =>
    exactKeyToken(ownerRequest, key),
  );
  if (exactActiveMatches.length !== 1) {
    return { state: "ambiguous" };
  }
  if (
    experiences.filter(({ key }) => key === exactActiveMatches[0]!.key)
      .length !== 1
  ) {
    return { state: "unknown" };
  }
  return {
    state: "selected",
    scope: {
      preorder_key: exactActiveMatches[0]!.key,
      selection: "explicit_request",
    },
  };
}
