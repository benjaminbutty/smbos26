import {
  AI_BUSINESS_CONTEXT_MAX_BYTES,
  aiBusinessModelContextV1Schema,
  type AiBusinessModelContextV1,
} from "../../src/ai/context/schemas";
import { serializeAiBusinessModelContext } from "../../src/ai/context/projector";
import { syntheticBusinessContext } from "./synthetic-business-context";

export const configurationDraftingSyntheticContextIds = [
  "rich_existing_business",
  "empty_new_business",
] as const;

export type ConfigurationDraftingSyntheticContextId =
  (typeof configurationDraftingSyntheticContextIds)[number];

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function parseFrozenContext(value: unknown): AiBusinessModelContextV1 {
  const parsed = aiBusinessModelContextV1Schema.parse(value);
  const serializedBytes = new TextEncoder().encode(
    serializeAiBusinessModelContext(parsed),
  ).byteLength;
  if (serializedBytes > AI_BUSINESS_CONTEXT_MAX_BYTES) {
    throw new RangeError(
      "The configuration-drafting synthetic context is too large.",
    );
  }
  return deepFreeze(parsed);
}

/**
 * This is a parsed clone so the planning fixture remains frozen and untouched.
 * It contains the existing Customer, Order, Forms, Views, Page/Form keys and
 * capability registry needed by the drafting scenarios.
 */
export const richExistingBusinessContext = parseFrozenContext(
  structuredClone(syntheticBusinessContext),
);

export const emptyNewBusinessContext = parseFrozenContext({
  schema_version: 1,
  business: {
    name: "Synthetic Meadow Workshop",
    business_type: "equipment maintenance business",
    timezone: "Europe/London",
  },
  access: {
    role: "owner",
    capabilities: ["manage_configuration"],
  },
  active_configuration: {
    version_number: 1,
    revision: 1,
  },
  locations: [],
  objects: [],
  relationships: [],
  views: [],
  forms: [],
  pages: [],
  preorder_experiences: [],
  platform_capabilities: structuredClone(
    syntheticBusinessContext.platform_capabilities,
  ),
});

export const configurationDraftingSyntheticContexts = Object.freeze({
  rich_existing_business: richExistingBusinessContext,
  empty_new_business: emptyNewBusinessContext,
}) satisfies Readonly<
  Record<ConfigurationDraftingSyntheticContextId, AiBusinessModelContextV1>
>;

export const configurationDraftingSyntheticContextBytes = Object.freeze({
  rich_existing_business: new TextEncoder().encode(
    serializeAiBusinessModelContext(richExistingBusinessContext),
  ).byteLength,
  empty_new_business: new TextEncoder().encode(
    serializeAiBusinessModelContext(emptyNewBusinessContext),
  ).byteLength,
});
