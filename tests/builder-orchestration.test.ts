import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  AiAccountingStore,
  BusinessAiSettings,
} from "../src/ai/accounting/service";
import { AiAccountingServiceError } from "../src/ai/accounting/service";
import {
  builderConfigurationDraftOutputSchema,
  type BuilderConfigurationDraftOutput,
} from "../src/ai/configuration-drafting/schemas";
import { builderLocationCreationIntentOutputSchema } from "../src/ai/location-creation-intent/schemas";
import { BuilderConfigurationProposalError } from "../src/ai/configuration-proposal/errors";
import {
  builderConfigurationProposalResultSchema,
  type BuilderConfigurationProposalResult,
} from "../src/ai/configuration-proposal/contracts";
import {
  builderClarificationResultSchema,
  builderOrchestrationRequestSchema,
  builderProposedResultSchema,
  builderUnsupportedResultSchema,
} from "../src/ai/builder/contracts";
import { AiBuilderError } from "../src/ai/builder/errors";
import {
  createBuilderAiRuntime,
  type BuilderAiRuntime,
  type BuilderExecutionCore,
} from "../src/ai/builder/runtime";
import { createBuilderOrchestrationService } from "../src/ai/builder/service";
import type { StructuredAiProvider } from "../src/ai/contracts";
import { AiExecutionError } from "../src/ai/errors";
import { projectAiBusinessModelContext } from "../src/ai/context/projector";
import {
  BUILDER_LOCATION_CREATION_TERRA_MEDIUM_POLICY_KEY,
  BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
  BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY,
  BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY,
  BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY,
  openAiBuilderLocationCreationPolicy,
  openAiBuilderConfigurationDraftingPolicy,
  openAiBuilderPreorderAmendmentPolicy,
  openAiBuilderPlanningPolicy,
  openAiBuilderRecordCreationIntentPolicy,
  openAiBuilderRecordLocationLinkIntentPolicy,
  openAiBuilderRecordUpdateIntentPolicy,
  disabledExecutionPolicies,
} from "../src/ai/policies";
import {
  builderPlanOutputSchema,
  type BuilderPlanOutput,
} from "../src/ai/planning/schemas";
import { builderConfigurationDraftTaskV1 } from "../src/ai/configuration-drafting/task";
import { builderLocationCreationIntentTaskV1 } from "../src/ai/location-creation-intent/task";
import { builderPreorderAmendmentTaskV1 } from "../src/ai/preorder-amendment/task";
import { builderRecordCreationIntentTaskV1 } from "../src/ai/record-creation-intent/task";
import { builderRecordUpdateIntentTaskV1 } from "../src/ai/record-update-intent/task";
import { builderRecordLocationLinkIntentTaskV1 } from "../src/ai/record-location-link-intent/task";
import { builderRecordCreationIntentOutputSchema } from "../src/ai/record-creation-intent/schemas";
import { builderRecordLocationLinkIntentOutputSchema } from "../src/ai/record-location-link-intent/schemas";
import type { AuthoritativeAiBusinessContext } from "../src/core/configuration/builder-context-source";
import type { ConfigurationSnapshotV1 } from "../src/core/configuration/definition-source";
import {
  normalizeLocationName,
  type LocationCreationState,
} from "../src/core/locations/schemas";
import type { RecordCreationState } from "../src/core/graph/record-creation/schemas";
import {
  recordLocationLinkTargetStateSchema,
  type RecordLocationLinkTargetState,
} from "../src/core/graph/record-location-availability/schemas";
import type { Database } from "../src/db/supabase/database.types";

type Client = SupabaseClient<Database>;

const ids = {
  actor: "90000000-0000-4000-8000-000000000001",
  otherActor: "90000000-0000-4000-8000-000000000002",
  business: "90000000-0000-4000-8000-000000000003",
  otherBusiness: "90000000-0000-4000-8000-000000000004",
  version: "90000000-0000-4000-8000-000000000005",
  otherVersion: "90000000-0000-4000-8000-000000000006",
  location: "90000000-0000-4000-8000-000000000007",
} as const;

function emptySnapshot(): ConfigurationSnapshotV1 {
  return {
    schema_version: 1,
    object_definitions: [],
    field_definitions: [],
    relationship_definitions: [],
    views: [],
    forms: [],
    pages: [],
    preorder_experiences: [],
    preorder_experience_locations: [],
  };
}

function source(
  overrides: {
    businessName?: string;
    locationName?: string;
    snapshot?: ConfigurationSnapshotV1;
  } = {},
) {
  return {
    business: {
      name: overrides.businessName ?? "Example Bakery",
      businessType: "bakery",
      timezone: "Europe/London",
    },
    access: {
      role: "owner" as const,
      capabilities: ["manage_configuration"] as const,
    },
    activeConfiguration: {
      versionNumber: 1,
      revision: 1,
      snapshot: overrides.snapshot ?? emptySnapshot(),
    },
    locations: [
      {
        reference: ids.location,
        name: overrides.locationName ?? "Bedford",
        timezone: "Europe/London",
        isActive: true,
      },
    ],
  };
}

function authoritative(
  overrides: {
    businessId?: string;
    actorId?: string;
    versionId?: string;
    revision?: number;
    contextSource?: ReturnType<typeof source>;
  } = {},
): AuthoritativeAiBusinessContext {
  return {
    executionContext: {
      businessId: overrides.businessId ?? ids.business,
      actorId: overrides.actorId ?? ids.actor,
    },
    currentness: {
      baseVersionId: overrides.versionId ?? ids.version,
      headRevision: overrides.revision ?? 1,
    },
    source: overrides.contextSource ?? source(),
  };
}

function locationCreationState(
  overrides: Partial<LocationCreationState> = {},
): LocationCreationState {
  return {
    schema_version: 1,
    business_id: ids.business,
    actor_id: ids.actor,
    business_timezone: "Europe/London",
    location_state_digest: "a".repeat(64),
    locations: [],
    ...overrides,
  };
}

function locationSummary(name: string, isActive = true) {
  return {
    id: ids.location,
    name,
    normalized_name: normalizeLocationName(name),
    slug: normalizeLocationName(name).replace(/[^a-z0-9]+/g, "-") || "location",
    timezone: "Europe/London",
    is_active: isActive,
  };
}

function locationIntentOutput(name: string) {
  return builderLocationCreationIntentOutputSchema.parse({
    schema_version: 1,
    state: "ready",
    summary: `Add ${name} as one new Location.`,
    location_name: name,
    timezone_intent: { kind: "use_business_timezone" },
    source_step_references: ["step_1"],
  });
}

function recordCreationState(
  overrides: Partial<RecordCreationState> = {},
): RecordCreationState {
  return {
    schema_version: 1,
    business_id: ids.business,
    actor_id: ids.actor,
    base_version_id: ids.version,
    head_revision: 1,
    object_definition_id: "90000000-0000-4000-8000-000000000011",
    object_key: "product",
    singular_label: "Product",
    plural_label: "Products",
    is_active: true,
    eligibility: { eligible: true, reason_codes: [] },
    object_schema_digest: "a".repeat(64),
    record_state_digest: "b".repeat(64),
    fields: [
      {
        key: "name",
        label: "Name",
        field_type: "short_text",
        required: true,
        default_value: null,
        settings_json: {},
        position: 1,
        is_active: true,
      },
      {
        key: "price",
        label: "Price",
        field_type: "currency",
        required: true,
        default_value: null,
        settings_json: { currency: "GBP" },
        position: 2,
        is_active: true,
      },
      {
        key: "status",
        label: "Status",
        field_type: "status",
        required: true,
        default_value: "Active",
        settings_json: { options: ["Active", "Paused"] },
        position: 3,
        is_active: true,
      },
    ],
    internal_views: [
      {
        key: "products",
        name: "Products",
        view_type: "table",
        object_key: "product",
      },
    ],
    ...overrides,
  };
}

function recordIntentOutput() {
  return builderRecordCreationIntentOutputSchema.parse({
    schema_version: 1,
    state: "ready",
    summary: "Add Afternoon Tea Box at £30.",
    source_step_references: ["step_1"],
    object_key: "product",
    field_values: [
      {
        field_key: "name",
        field_type: "short_text",
        string_value: "Afternoon Tea Box",
      },
      { field_key: "price", field_type: "currency", number_value: 30 },
    ],
  });
}

function recordContext(): AuthoritativeAiBusinessContext {
  return authoritative({
    contextSource: source({
      snapshot: {
        ...emptySnapshot(),
        object_definitions: [
          {
            id: "90000000-0000-4000-8000-000000000011",
            key: "product",
            singular_label: "Product",
            plural_label: "Products",
            description: "Products",
            kind: "template",
            semantic_type: "product",
            icon: null,
            is_active: true,
          },
        ],
        field_definitions: [
          {
            id: "90000000-0000-4000-8000-000000000012",
            object_definition_id: "90000000-0000-4000-8000-000000000011",
            object_key: "product",
            key: "name",
            label: "Name",
            field_type: "short_text",
            required: true,
            default_value: null,
            settings_json: {},
            position: 1,
            is_active: true,
          },
          {
            id: "90000000-0000-4000-8000-000000000013",
            object_definition_id: "90000000-0000-4000-8000-000000000011",
            object_key: "product",
            key: "price",
            label: "Price",
            field_type: "currency",
            required: true,
            default_value: null,
            settings_json: { currency: "GBP" },
            position: 2,
            is_active: true,
          },
          {
            id: "90000000-0000-4000-8000-000000000014",
            object_definition_id: "90000000-0000-4000-8000-000000000011",
            object_key: "product",
            key: "status",
            label: "Status",
            field_type: "status",
            required: true,
            default_value: "Active",
            settings_json: { options: ["Active", "Paused"] },
            position: 3,
            is_active: true,
          },
        ],
      },
    }),
  });
}

function recordLocationPlan(): Extract<BuilderPlanOutput, { state: "ready" }> {
  const parsed = builderPlanOutputSchema.parse({
    schema_version: 1,
    state: "ready",
    understanding: "The owner wants to change one Product's availability.",
    assumptions: [],
    unsupported_requirements: [],
    plan: {
      outcome:
        "One Product's Location availability changes after confirmation.",
      concepts: [
        {
          reference: "concept_1",
          label: "Product",
          disposition: "existing",
          existing_object_key: "product",
          purpose: "The existing Product Record.",
        },
      ],
      user_journeys: [],
      steps: [
        {
          reference: "step_1",
          sequence: 1,
          summary: "Change one Product's Location availability.",
          dependencies: [],
          affected_concepts: ["concept_1"],
          existing_object_keys: ["product"],
          location_references: [ids.location],
          materiality: "medium",
          requires_owner_confirmation: true,
          lane: "operational",
          category: "link_record_to_location",
        },
      ],
    },
  });
  if (parsed.state !== "ready") {
    throw new Error("Expected a ready Record-to-Location plan.");
  }
  return parsed;
}

function recordLocationState(
  overrides: Partial<
    Extract<RecordLocationLinkTargetState, { state: "ready" }>
  > = {},
): RecordLocationLinkTargetState {
  return recordLocationLinkTargetStateSchema.parse({
    schema_version: 1,
    state: "ready",
    business_id: ids.business,
    actor_id: ids.actor,
    object_definition_id: "90000000-0000-4000-8000-000000000011",
    object_key: "product",
    singular_label: "Product",
    target_record_id: "90000000-0000-4000-8000-000000000021",
    target_location_id: ids.location,
    location_name: "Bedford",
    location_is_active: true,
    action: "link",
    expected_pair_state: "unlinked",
    selector: {
      field_key: "name",
      field_type: "short_text",
      string_value: "Kids Afternoon Tea",
    },
    destination_view_key: "products",
    ...overrides,
  });
}

function readyPlan(
  category:
    | "define_object"
    | "configure_preorder"
    | "create_location"
    | "update_location"
    | "create_initial_record"
    | "configure_view" = "define_object",
): Extract<BuilderPlanOutput, { state: "ready" }> {
  const configuration =
    category === "create_location" ||
    category === "update_location" ||
    category === "create_initial_record"
      ? "operational"
      : "configuration";
  const parsed = builderPlanOutputSchema.parse({
    schema_version: 1,
    state: "ready",
    understanding: "The owner wants a bounded setup change.",
    assumptions: [],
    plan: {
      outcome: "The Business can review the proposed setup.",
      concepts:
        category === "define_object"
          ? [
              {
                reference: "concept_1",
                label: "Catering Enquiry",
                disposition: "new",
                purpose: "Capture a catering enquiry.",
              },
            ]
          : category === "create_initial_record"
            ? [
                {
                  reference: "concept_1",
                  label: "Product",
                  disposition: "existing",
                  existing_object_key: "product",
                  purpose: "The Product to add.",
                },
              ]
            : [],
      user_journeys: [],
      steps: [
        {
          reference: "step_1",
          sequence: 1,
          summary: "Prepare the bounded owner-reviewed change.",
          dependencies: [],
          affected_concepts:
            category === "define_object" || category === "create_initial_record"
              ? ["concept_1"]
              : [],
          existing_object_keys:
            category === "create_initial_record" ? ["product"] : [],
          location_references: category === "create_location" ? [] : [],
          materiality: "low",
          requires_owner_confirmation: true,
          lane: configuration,
          category,
        },
      ],
    },
    unsupported_requirements: [],
  });
  if (parsed.state !== "ready") {
    throw new Error("Expected a ready plan.");
  }
  return parsed;
}

function clarification(): Extract<
  BuilderPlanOutput,
  { state: "needs_clarification" }
> {
  return {
    schema_version: 1,
    state: "needs_clarification",
    understanding: "The request needs one bounded choice.",
    known_requirements: ["The owner wants a new enquiry experience."],
    assumptions: [],
    questions: [
      {
        reference: "question_1",
        question: "Which details should the form collect?",
        reason: "The fields depend on this choice.",
        response_style: "single_choice",
        options: ["Event details", "Contact details"],
      },
    ],
    unsupported_requirements: [],
  };
}

function mixedPlan(): Extract<BuilderPlanOutput, { state: "ready" }> {
  const parsed = builderPlanOutputSchema.parse({
    ...readyPlan("define_object"),
    plan: {
      ...readyPlan("define_object").plan,
      steps: [
        readyPlan("define_object").plan.steps[0],
        {
          ...readyPlan("create_location").plan.steps[0],
          reference: "step_2",
          sequence: 2,
        },
      ],
    },
  });
  if (parsed.state !== "ready") {
    throw new Error("Expected a ready mixed plan.");
  }
  return parsed;
}

function draft(): BuilderConfigurationDraftOutput {
  return builderConfigurationDraftOutputSchema.parse({
    schema_version: 1,
    summary: "Bounded draft summary marker.",
    objects: [
      {
        reference: "draft_object_1",
        concept_reference: "concept_1",
        source_step_references: ["step_1"],
        singular_label: "Catering Enquiry",
        plural_label: "Catering Enquiries",
        description: "Raw draft content marker that must not escape.",
      },
    ],
    fields: [],
    relationships: [],
    views: [],
    forms: [],
    pages: [],
  });
}

function proposalResult(): BuilderConfigurationProposalResult {
  return builderConfigurationProposalResultSchema.parse({
    schema_version: 1,
    proposal_id: "90000000-0000-4000-8000-000000000008",
    status: "proposed",
    base_version_id: ids.version,
    base_head_revision: 1,
    operation_count: 1,
  });
}

const enabledSettings = {
  business_id: ids.business,
  is_enabled: true,
  daily_request_limit: 100,
  daily_input_token_limit: 1_000_000,
  daily_output_token_limit: 1_000_000,
  daily_cost_limit_microusd: 100_000_000,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  updated_by: null,
} satisfies BusinessAiSettings;

interface HarnessOptions {
  planningOutput?: BuilderPlanOutput;
  draftOutput?: BuilderConfigurationDraftOutput;
  recordIntentOutput?: unknown;
  recordLocationIntentOutput?: unknown;
  firstContext?: AuthoritativeAiBusinessContext;
  secondContext?: AuthoritativeAiBusinessContext;
  planningFailure?: unknown;
  draftingFailure?: unknown;
  locationIntentOutput?: unknown;
  locationIntentFailure?: unknown;
  recordLocationIntentFailure?: unknown;
  firstLocationState?: LocationCreationState;
  secondLocationState?: LocationCreationState;
  firstRecordState?: RecordCreationState;
  secondRecordState?: RecordCreationState;
  firstRecordLocationState?: RecordLocationLinkTargetState;
  secondRecordLocationState?: RecordLocationLinkTargetState;
  settings?: BusinessAiSettings;
  reserveFailure?: { taskKey: string; error: unknown };
  proposalError?: unknown;
}

function harness(options: HarnessOptions = {}) {
  const events: string[] = [];
  const planningInputs: unknown[] = [];
  const draftingInputs: unknown[] = [];
  const locationIntentInputs: unknown[] = [];
  const recordIntentInputs: unknown[] = [];
  const recordLocationIntentInputs: unknown[] = [];
  const contexts = [
    options.firstContext ?? authoritative(),
    options.secondContext ?? options.firstContext ?? authoritative(),
  ];
  const loadContext = vi.fn(async () => {
    events.push("context");
    const context = contexts.shift();
    if (!context) {
      throw new Error("Unexpected context load.");
    }
    return context;
  });
  const locationStates = [
    options.firstLocationState ?? locationCreationState(),
    options.secondLocationState ??
      options.firstLocationState ??
      locationCreationState(),
  ];
  const readLocationCreationState = vi.fn(async () => {
    events.push("location-state");
    const state = locationStates.shift();
    if (!state) {
      throw new Error("Unexpected Location state load.");
    }
    return state;
  });
  const recordStates = [
    options.firstRecordState ?? recordCreationState(),
    options.secondRecordState ??
      options.firstRecordState ??
      recordCreationState(),
  ];
  const readRecordCreationState = vi.fn(async () => {
    events.push("record-state");
    const state = recordStates.shift();
    if (!state) {
      throw new Error("Unexpected Record state load.");
    }
    return state;
  });
  const recordLocationStates = [
    options.firstRecordLocationState ?? recordLocationState(),
    options.secondRecordLocationState ??
      options.firstRecordLocationState ??
      recordLocationState(),
  ];
  const readRecordLocationLinkState = vi.fn(async () => {
    events.push("record-location-state");
    const state = recordLocationStates.shift();
    if (!state) {
      throw new Error("Unexpected Record-to-Location state load.");
    }
    return state;
  });
  const accounting: AiAccountingStore = {
    readSettings: vi.fn(async () => options.settings ?? enabledSettings),
    reserve: vi.fn(async (request) => {
      events.push(`reserve:${request.taskKey}`);
      const reserveFailure = options.reserveFailure;
      if (reserveFailure && reserveFailure.taskKey === request.taskKey) {
        throw reserveFailure.error;
      }
      return {} as never;
    }),
    settle: vi.fn(async (request) => {
      events.push(`settle:${request.executionId}`);
      return {} as never;
    }),
  };
  const preparedOutputs = new WeakMap<
    object,
    { taskKey: string; output: unknown; failure: unknown }
  >();
  const execution: BuilderExecutionCore = {
    prepare: vi.fn((taskKey, input) => {
      const isPlanning = taskKey === "builder_plan_v1";
      const isLocationIntent =
        taskKey === "builder_location_creation_intent_v1";
      const isRecordIntent = taskKey === "builder_record_creation_intent_v1";
      const isRecordLocationIntent =
        taskKey === "builder_record_location_link_intent_v1";
      events.push(
        isPlanning
          ? "planning"
          : isLocationIntent
            ? "location-intent"
            : isRecordIntent
              ? "record-intent"
              : isRecordLocationIntent
                ? "record-location-intent"
                : "drafting",
      );
      if (taskKey === "builder_plan_v1") {
        planningInputs.push(input);
      } else if (isLocationIntent) {
        locationIntentInputs.push(input);
      } else if (isRecordIntent) {
        recordIntentInputs.push(input);
      } else if (isRecordLocationIntent) {
        recordLocationIntentInputs.push(input);
      } else {
        draftingInputs.push(input);
      }
      const prepared = {
        descriptor: {
          taskKey,
          taskVersion: 1,
          purposeLabel:
            taskKey === "builder_plan_v1"
              ? "Plan a bounded Business request"
              : isLocationIntent
                ? "Draft one bounded Location creation intent"
                : isRecordIntent
                  ? "Draft one bounded generic Record creation intent"
                  : isRecordLocationIntent
                    ? "Draft one bounded generic Record-to-Location availability intent"
                    : "Draft bounded additive configuration intent",
          policy:
            taskKey === "builder_plan_v1"
              ? openAiBuilderPlanningPolicy
              : isLocationIntent
                ? openAiBuilderLocationCreationPolicy
                : isRecordIntent
                  ? openAiBuilderRecordCreationIntentPolicy
                  : isRecordLocationIntent
                    ? disabledExecutionPolicies[
                        "builder_record_location_link_intent_disabled_v1"
                      ]
                    : openAiBuilderConfigurationDraftingPolicy,
        },
      };
      preparedOutputs.set(prepared, {
        taskKey,
        output:
          taskKey === "builder_plan_v1"
            ? (options.planningOutput ?? readyPlan())
            : isLocationIntent
              ? (options.locationIntentOutput ??
                builderLocationCreationIntentOutputSchema.parse({
                  schema_version: 1,
                  state: "ready",
                  summary: "Add Cambridge as one new Location.",
                  location_name: "Cambridge",
                  timezone_intent: { kind: "use_business_timezone" },
                  source_step_references: ["step_1"],
                }))
              : isRecordIntent
                ? (options.recordIntentOutput ?? recordIntentOutput())
                : isRecordLocationIntent
                  ? (options.recordLocationIntentOutput ??
                    builderRecordLocationLinkIntentOutputSchema.parse({
                      schema_version: 1,
                      state: "ready",
                      summary: "Make one Product available at one Location.",
                      source_step_reference: "step_1",
                      action: "link",
                      object_key: "product",
                      selector: {
                        field_key: "name",
                        field_type: "short_text",
                        string_value: "Kids Afternoon Tea",
                      },
                      location_reference: ids.location,
                    }))
                  : (options.draftOutput ?? draft()),
        failure:
          taskKey === "builder_plan_v1"
            ? options.planningFailure
            : isLocationIntent
              ? options.locationIntentFailure
              : isRecordIntent
                ? undefined
                : isRecordLocationIntent
                  ? options.recordLocationIntentFailure
                  : options.draftingFailure,
      });
      return prepared;
    }),
    executePrepared: vi.fn(async (prepared) => {
      const value = preparedOutputs.get(prepared);
      if (!value) {
        throw new Error("Unexpected prepared execution.");
      }
      if (value.failure) {
        throw value.failure;
      }
      return {
        output: value.output,
        accounting: {
          attemptsStarted: 1,
          inputTokens: 10,
          outputTokens: 10,
          usageReported: true,
          usageComplete: true,
          providerInvocationStarted: true,
          failureBeforeProviderInvocation: false,
        },
        metadata: {
          taskKey: value.taskKey,
          taskVersion: 1,
          purposeLabel: "test",
          providerKey: "openai",
          modelKey: "gpt-5.6-terra",
          attempts: 1,
          usage: { inputTokens: 10, outputTokens: 10, complete: true },
          requestMetadata: { secret_provider_marker: "transient" },
        },
      };
    }),
  };
  const proposalService = {
    propose: vi.fn(async () => {
      events.push("proposal-orchestration");
      if (options.proposalError) {
        throw options.proposalError;
      }
      return proposalResult();
    }),
  };
  const runtime = {} as BuilderAiRuntime;
  const service = createBuilderOrchestrationService({
    loadContext,
    createRuntime: vi.fn(() => runtime),
    createExecution: vi.fn(() => execution),
    createAccounting: vi.fn(() => accounting),
    proposalService,
    readLocationCreationState,
    readRecordCreationState,
    readRecordLocationLinkState,
    generateExecutionId: vi
      .fn()
      .mockReturnValueOnce("90000000-0000-4000-8000-000000000009")
      .mockReturnValueOnce("90000000-0000-4000-8000-000000000010"),
  });
  return {
    service,
    client: {} as Client,
    events,
    planningInputs,
    draftingInputs,
    locationIntentInputs,
    recordIntentInputs,
    recordLocationIntentInputs,
    loadContext,
    accounting,
    execution,
    proposalService,
    readLocationCreationState,
    readRecordCreationState,
    readRecordLocationLinkState,
  };
}

describe("authenticated Builder orchestration contract", () => {
  it("accepts only the strict trimmed request", () => {
    expect(
      builderOrchestrationRequestSchema.parse({
        businessId: ids.business,
        ownerRequest: "  Create a catering enquiry.  ",
      }),
    ).toEqual({
      businessId: ids.business,
      ownerRequest: "Create a catering enquiry.",
    });

    for (const invalid of [
      { businessId: ids.business, ownerRequest: " " },
      { businessId: "not-a-uuid", ownerRequest: "Create a form." },
      {
        businessId: ids.business,
        ownerRequest: "Create a form.",
        actorId: ids.actor,
      },
      {
        businessId: ids.business,
        ownerRequest: "Create a form.",
        model: "other",
      },
      {
        businessId: ids.business,
        ownerRequest: "Create a form.",
        policy: "other",
      },
      { businessId: ids.business, ownerRequest: "Create a form.", context: {} },
      { businessId: ids.business, ownerRequest: "Create a form.", plan: {} },
      { businessId: ids.business, ownerRequest: "Create a form.", draft: {} },
      {
        businessId: ids.business,
        ownerRequest: "Create a form.",
        operations: [],
      },
    ]) {
      expect(builderOrchestrationRequestSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
    expect(
      builderOrchestrationRequestSchema.safeParse({
        businessId: ids.business,
        ownerRequest: "x".repeat(4_001),
      }).success,
    ).toBe(false);
  });

  it("rejects invalid requests before context or accounting", async () => {
    const test = harness();
    await expect(
      test.service.run(test.client, {
        businessId: ids.business,
        ownerRequest: " ",
      }),
    ).rejects.toMatchObject({ code: "ai_builder_request_invalid" });
    expect(test.loadContext).not.toHaveBeenCalled();
    expect(test.accounting.readSettings).not.toHaveBeenCalled();

    const overBytes = harness();
    await expect(
      overBytes.service.run(overBytes.client, {
        businessId: ids.business,
        ownerRequest: "😀".repeat(4_001),
      }),
    ).rejects.toMatchObject({ code: "ai_builder_request_invalid" });
    expect(overBytes.loadContext).not.toHaveBeenCalled();
  });

  it("returns strict frozen clarification and does not draft", async () => {
    const test = harness({ planningOutput: clarification() });
    const result = await test.service.run(test.client, {
      businessId: ids.business,
      ownerRequest: "  Create a catering enquiry.  ",
    });
    expect(result).toEqual({
      schema_version: 1,
      state: "needs_clarification",
      clarification: clarification(),
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(
      Object.isFrozen((result as { clarification: unknown }).clarification),
    ).toBe(true);
    expect(result).not.toHaveProperty("business_context");
    expect(result).not.toHaveProperty("accounting");
    expect(test.execution.prepare).toHaveBeenCalledTimes(1);
    expect(test.proposalService.propose).not.toHaveBeenCalled();
    expect(test.accounting.reserve).toHaveBeenCalledTimes(1);
    expect(builderClarificationResultSchema.safeParse(result).success).toBe(
      true,
    );
  });

  it("returns the bounded unsupported result for operational, mixed, and preorder plans", async () => {
    for (const [plan, reason] of [
      [readyPlan("update_location"), "operational_plan_unavailable"],
      [mixedPlan(), "mixed_plan_unavailable"],
      [readyPlan("configure_preorder"), "configuration_category_unavailable"],
    ] as const) {
      const test = harness({ planningOutput: plan });
      const result = await test.service.run(test.client, {
        businessId: ids.business,
        ownerRequest: "Prepare this request.",
      });
      expect(result).toMatchObject({
        state: "unsupported",
        reason_code: reason,
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(test.execution.prepare).toHaveBeenCalledTimes(1);
      expect(test.locationIntentInputs).toHaveLength(0);
      expect(test.accounting.reserve).toHaveBeenCalledTimes(1);
      expect(test.proposalService.propose).not.toHaveBeenCalled();
      expect(builderUnsupportedResultSchema.safeParse(result).success).toBe(
        true,
      );
    }
  });

  it("routes one create_location step through a separate intent and currentness read", async () => {
    const test = harness({ planningOutput: readyPlan("create_location") });
    const result = await test.service.run(test.client, {
      businessId: ids.business,
      ownerRequest: "Add Cambridge as a new Location.",
    });

    expect(result).toEqual({
      schema_version: 1,
      state: "location_confirmation",
      intent_schema_version: 1,
      location_name: "Cambridge",
      timezone: "Europe/London",
      timezone_source: "business_timezone",
      business_timezone: "Europe/London",
      location_state_digest: "a".repeat(64),
    });
    expect(test.events).toEqual([
      "context",
      "planning",
      "reserve:builder_plan_v1",
      "settle:90000000-0000-4000-8000-000000000009",
      "context",
      "location-state",
      "location-intent",
      "reserve:builder_location_creation_intent_v1",
      "settle:90000000-0000-4000-8000-000000000010",
      "location-state",
    ]);
    expect(test.locationIntentInputs).toHaveLength(1);
    expect(test.locationIntentInputs[0]).toEqual(
      expect.objectContaining({
        owner_request: "Add Cambridge as a new Location.",
        ready_plan: readyPlan("create_location"),
      }),
    );
    expect(test.accounting.reserve).toHaveBeenCalledTimes(2);
    expect(test.proposalService.propose).not.toHaveBeenCalled();
  });

  it("routes one generic create_initial_record step through typed intent and Record currentness", async () => {
    const test = harness({
      planningOutput: readyPlan("create_initial_record"),
      firstContext: recordContext(),
    });
    const result = await test.service.run(test.client, {
      businessId: ids.business,
      ownerRequest:
        "Add an active Product called Afternoon Tea Box priced at £30.",
    });

    expect(result).toMatchObject({
      schema_version: 1,
      state: "record_confirmation",
      intent_schema_version: 1,
      object_key: "product",
      object_label: "Product",
      explicit_fields: expect.arrayContaining([
        expect.objectContaining({
          label: "Name",
          formatted_value: "Afternoon Tea Box",
          source: "explicit",
        }),
        expect.objectContaining({
          label: "Price",
          formatted_value: "£30.00",
          source: "explicit",
        }),
      ]),
      default_fields: [
        expect.objectContaining({
          label: "Status",
          formatted_value: "Active",
          source: "default",
        }),
      ],
      base_version_id: ids.version,
      head_revision: 1,
      object_schema_digest: "a".repeat(64),
      record_state_digest: "b".repeat(64),
    });
    expect(test.events).toEqual([
      "context",
      "planning",
      "reserve:builder_plan_v1",
      "settle:90000000-0000-4000-8000-000000000009",
      "context",
      "record-state",
      "record-intent",
      "reserve:builder_record_creation_intent_v1",
      "settle:90000000-0000-4000-8000-000000000010",
      "record-state",
    ]);
    expect(test.recordIntentInputs).toHaveLength(1);
    expect(test.recordIntentInputs[0]).toEqual(
      expect.objectContaining({
        owner_request:
          "Add an active Product called Afternoon Tea Box priced at £30.",
        ready_plan: readyPlan("create_initial_record"),
      }),
    );
    expect(test.accounting.reserve).toHaveBeenCalledTimes(2);
    expect(test.proposalService.propose).not.toHaveBeenCalled();
  });

  it("routes one generic Record-to-Location action through typed intent without configuration currentness", async () => {
    const test = harness({
      planningOutput: recordLocationPlan(),
      firstContext: recordContext(),
      firstRecordLocationState: recordLocationState(),
      secondRecordLocationState: recordLocationState(),
    });
    const result = await test.service.run(test.client, {
      businessId: ids.business,
      ownerRequest: "Make the Kids Afternoon Tea available at Bedford.",
    });

    expect(result).toMatchObject({
      schema_version: 1,
      state: "record_location_confirmation",
      intent_schema_version: 1,
      action: "link",
      object_label: "Product",
      location_name: "Bedford",
      selector_presentation: {
        label: "Name",
        formatted_value: "Kids Afternoon Tea",
      },
      object_definition_id: "90000000-0000-4000-8000-000000000011",
      object_key: "product",
      target_record_id: "90000000-0000-4000-8000-000000000021",
      target_location_id: ids.location,
      expected_pair_state: "unlinked",
      destination_view_key: "products",
    });
    expect(result).not.toHaveProperty("base_version_id");
    expect(result).not.toHaveProperty("head_revision");
    expect(test.events).toEqual([
      "context",
      "planning",
      "reserve:builder_plan_v1",
      "settle:90000000-0000-4000-8000-000000000009",
      "context",
      "record-location-intent",
      "reserve:builder_record_location_link_intent_v1",
      "settle:90000000-0000-4000-8000-000000000010",
      "record-location-state",
    ]);
    expect(test.recordLocationIntentInputs).toHaveLength(1);
    expect(test.recordLocationIntentInputs[0]).toEqual(
      expect.objectContaining({
        owner_request: "Make the Kids Afternoon Tea available at Bedford.",
        ready_plan: recordLocationPlan(),
      }),
    );
    expect(test.readRecordLocationLinkState).toHaveBeenCalledTimes(1);
    expect(test.accounting.reserve).toHaveBeenCalledTimes(2);
    expect(test.proposalService.propose).not.toHaveBeenCalled();
  });

  it("discards the Record confirmation when Object Record state changes during intent generation", async () => {
    const test = harness({
      planningOutput: readyPlan("create_initial_record"),
      firstContext: recordContext(),
      firstRecordState: recordCreationState(),
      secondRecordState: recordCreationState({
        record_state_digest: "c".repeat(64),
      }),
    });

    await expect(
      test.service.run(test.client, {
        businessId: ids.business,
        ownerRequest: "Add a Product called Afternoon Tea Box priced at £30.",
      }),
    ).rejects.toMatchObject({ code: "ai_builder_context_stale" });
    expect(test.recordIntentInputs).toHaveLength(1);
    expect(test.proposalService.propose).not.toHaveBeenCalled();
    expect(test.accounting.reserve).toHaveBeenCalledTimes(2);
    expect(test.readRecordCreationState).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      existing: "Cambridge",
      active: true,
      requested: "Cambridge",
      ownerRequest: "Add Cambridge as a new Location.",
      expectedState: "location_conflict",
      expectedDuplicate: "active",
    },
    {
      existing: "Cambridge",
      active: false,
      requested: "Cambridge",
      ownerRequest: "Add Cambridge as a new Location.",
      expectedState: "location_conflict",
      expectedDuplicate: "inactive",
    },
    {
      existing: "Cambridge",
      active: true,
      requested: "Cambridge North",
      ownerRequest: "Add Cambridge North as a new Location.",
      expectedState: "location_confirmation",
    },
    {
      existing: "York",
      active: true,
      requested: "New York",
      ownerRequest: "Open a New York Location.",
      expectedState: "location_confirmation",
    },
    {
      existing: "Cambridge North",
      active: true,
      requested: "Cambridge",
      ownerRequest: "Add Cambridge as a new Location.",
      expectedState: "location_confirmation",
    },
  ] as const)(
    "uses only the exact interpreted Location name for duplicate checks: $existing -> $requested",
    async ({
      existing,
      active,
      requested,
      ownerRequest,
      expectedState,
      expectedDuplicate,
    }) => {
      const test = harness({
        planningOutput: readyPlan("create_location"),
        firstLocationState: locationCreationState({
          locations: [locationSummary(existing, active)],
        }),
        locationIntentOutput: locationIntentOutput(requested),
      });

      const result = await test.service.run(test.client, {
        businessId: ids.business,
        ownerRequest,
      });

      expect(result).toMatchObject({
        state: expectedState,
        location_name: requested,
      });
      if (expectedState === "location_conflict") {
        expect(result).toMatchObject({ duplicate_kind: expectedDuplicate });
      }
      expect(test.locationIntentInputs).toHaveLength(1);
    },
  );

  it("discards the Location confirmation when operational state changes during intent generation", async () => {
    const test = harness({
      planningOutput: readyPlan("create_location"),
      firstLocationState: locationCreationState(),
      secondLocationState: locationCreationState({
        location_state_digest: "b".repeat(64),
      }),
    });

    await expect(
      test.service.run(test.client, {
        businessId: ids.business,
        ownerRequest: "Add Cambridge as a new Location.",
      }),
    ).rejects.toMatchObject({ code: "ai_builder_context_stale" });
    expect(test.proposalService.propose).not.toHaveBeenCalled();
    expect(test.accounting.reserve).toHaveBeenCalledTimes(2);
    expect(test.readLocationCreationState).toHaveBeenCalledTimes(2);
  });

  it("runs one authenticated planning/drafting handoff with exact inputs", async () => {
    const test = harness();
    const result = await test.service.run(test.client, {
      businessId: ids.business,
      ownerRequest: "  Create a catering enquiry.  ",
    });
    const firstContext = authoritative();
    const initialModelContext = projectAiBusinessModelContext(
      firstContext.source,
    ).modelContext;
    expect(test.events.filter((event) => event === "context")).toHaveLength(2);
    expect(test.events).toEqual([
      "context",
      "planning",
      "reserve:builder_plan_v1",
      "settle:90000000-0000-4000-8000-000000000009",
      "context",
      "drafting",
      "reserve:builder_configuration_draft_v1",
      "settle:90000000-0000-4000-8000-000000000010",
      "proposal-orchestration",
    ]);
    expect(test.planningInputs[0]).toEqual({
      schema_version: 1,
      owner_request: "Create a catering enquiry.",
      business_context: initialModelContext,
    });
    expect(test.draftingInputs[0]).toEqual({
      schema_version: 1,
      owner_request: "Create a catering enquiry.",
      business_context: initialModelContext,
      ready_plan: readyPlan(),
    });
    expect(test.proposalService.propose).toHaveBeenCalledWith(
      test.client,
      expect.objectContaining({
        businessId: ids.business,
        expectedCurrentness: {
          baseVersionId: ids.version,
          headRevision: 1,
        },
        taskInput: test.draftingInputs[0],
        draft: draft(),
      }),
    );
    expect(result).toEqual({
      schema_version: 1,
      state: "proposed",
      proposal_id: "90000000-0000-4000-8000-000000000008",
      status: "proposed",
      base_version_id: ids.version,
      base_head_revision: 1,
      operation_count: 1,
      summary: "Bounded draft summary marker.",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(builderProposedResultSchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Raw draft content marker");
    expect(JSON.stringify(result)).not.toContain("secret_provider_marker");
  });

  it.each([
    ["business", authoritative({ businessId: ids.otherBusiness })],
    ["actor", authoritative({ actorId: ids.otherActor })],
    ["base version", authoritative({ versionId: ids.otherVersion })],
    ["head revision", authoritative({ revision: 2 })],
    [
      "business metadata",
      authoritative({
        contextSource: source({ businessName: "Changed Bakery" }),
      }),
    ],
    [
      "Location projection",
      authoritative({
        contextSource: source({ locationName: "Changed Bedford" }),
      }),
    ],
    [
      "configuration projection",
      authoritative({
        contextSource: source({
          snapshot: {
            ...emptySnapshot(),
            object_definitions: [
              {
                id: "10000000-0000-4000-8000-000000000001",
                key: "enquiry",
                singular_label: "Enquiry",
                plural_label: "Enquiries",
                description: "An enquiry.",
                kind: "custom",
                semantic_type: null,
                icon: null,
                is_active: true,
              },
            ],
          },
        }),
      }),
    ],
  ])("stops safely when %s changes after planning", async (_label, changed) => {
    const test = harness({ secondContext: changed });
    await expect(
      test.service.run(test.client, {
        businessId: ids.business,
        ownerRequest: "Prepare this request.",
      }),
    ).rejects.toMatchObject({ code: "ai_builder_context_stale" });
    expect(test.execution.prepare).toHaveBeenCalledTimes(1);
    expect(test.proposalService.propose).not.toHaveBeenCalled();
    expect(test.accounting.settle).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["disabled", new AiExecutionError("ai_disabled")],
    ["budget", new AiExecutionError("ai_budget_exceeded")],
    ["timeout", new AiExecutionError("ai_timeout")],
    ["invalid output", new AiExecutionError("ai_output_invalid")],
    ["accounting", new AiExecutionError("ai_accounting_failed")],
  ])("does not continue after a planning %s", async (_label, failure) => {
    const test = harness({ planningFailure: failure });
    await expect(
      test.service.run(test.client, {
        businessId: ids.business,
        ownerRequest: "Prepare this request.",
      }),
    ).rejects.toBe(failure);
    expect(test.execution.prepare).toHaveBeenCalledTimes(1);
    expect(test.proposalService.propose).not.toHaveBeenCalled();
    expect(JSON.stringify(failure)).toEqual(
      JSON.stringify({ code: failure.code, message: failure.message }),
    );
  });

  it("settles planning before a drafting reservation failure", async () => {
    const failure = new AiAccountingServiceError("budget", {
      message: "ai_budget_exceeded",
    });
    const test = harness({
      reserveFailure: {
        taskKey: "builder_configuration_draft_v1",
        error: failure,
      },
    });
    await expect(
      test.service.run(test.client, {
        businessId: ids.business,
        ownerRequest: "Prepare this request.",
      }),
    ).rejects.toMatchObject({ code: "ai_budget_exceeded" });
    expect(test.execution.prepare).toHaveBeenCalledTimes(2);
    expect(test.execution.executePrepared).toHaveBeenCalledTimes(1);
    expect(test.accounting.settle).toHaveBeenCalledTimes(1);
    expect(test.proposalService.propose).not.toHaveBeenCalled();
  });

  it.each([
    ["timeout", new AiExecutionError("ai_timeout")],
    ["invalid output", new AiExecutionError("ai_output_invalid")],
    ["provider", new AiExecutionError("ai_provider_unavailable")],
    ["accounting", new AiExecutionError("ai_accounting_failed")],
  ])(
    "does not retry the workflow after a drafting %s",
    async (_label, failure) => {
      const test = harness({ draftingFailure: failure });
      await expect(
        test.service.run(test.client, {
          businessId: ids.business,
          ownerRequest: "Prepare this request.",
        }),
      ).rejects.toBe(failure);
      expect(test.execution.prepare).toHaveBeenCalledTimes(2);
      expect(test.execution.executePrepared).toHaveBeenCalledTimes(2);
      expect(test.proposalService.propose).not.toHaveBeenCalled();
      expect(test.accounting.settle).toHaveBeenCalledTimes(
        failure.code === "ai_accounting_failed" ? 1 : 2,
      );
    },
  );

  it.each([
    "ai_configuration_proposal_context_stale",
    "ai_configuration_proposal_compile_failed",
    "ai_configuration_proposal_no_changes",
    "ai_configuration_proposal_failed",
  ] as const)("does not regenerate after proposal %s", async (code) => {
    const error = new BuilderConfigurationProposalError(code);
    const test = harness({ proposalError: error });
    await expect(
      test.service.run(test.client, {
        businessId: ids.business,
        ownerRequest: "Prepare this request.",
      }),
    ).rejects.toBe(error);
    expect(test.proposalService.propose).toHaveBeenCalledTimes(1);
    expect(test.execution.prepare).toHaveBeenCalledTimes(2);
  });

  it("serializes Builder errors without request, context, or provider details", () => {
    const error = new AiBuilderError("ai_builder_internal_failed", {
      cause: {
        ownerRequest: "owner-request-secret",
        context: "business-context-secret",
        provider: "provider-body-secret",
      },
    });
    expect(JSON.stringify(error)).toBe(
      JSON.stringify({
        code: "ai_builder_internal_failed",
        message: "The Builder request could not be completed safely.",
      }),
    );
  });
});

describe("private qualified Builder runtime", () => {
  it("keeps global drafting disabled and qualifies only the private clone", () => {
    expect(builderConfigurationDraftTaskV1.policyKey).toBe(
      "builder_configuration_drafting_disabled_v1",
    );
    const provider: StructuredAiProvider = {
      key: "openai",
      generateStructured: vi.fn(),
    };
    const runtime = createBuilderAiRuntime(
      { AI_PROVIDER: "openai", OPENAI_API_KEY: "test-key" },
      { createOpenAiProvider: () => provider },
    );
    expect(runtime.mode).toBe("openai");
    expect(Object.keys(runtime.tasks)).toHaveLength(7);
    expect(Object.keys(runtime.policies)).toHaveLength(7);
    expect(Object.keys(runtime.tasks)).toEqual([
      "builder_plan_v1",
      "builder_configuration_draft_v1",
      "builder_preorder_amendment_v1",
      "builder_location_creation_intent_v1",
      "builder_record_creation_intent_v1",
      "builder_record_update_intent_v1",
      "builder_record_location_link_intent_v1",
    ]);
    expect(runtime.tasks.builder_configuration_draft_v1!).not.toBe(
      builderConfigurationDraftTaskV1,
    );
    expect(runtime.tasks.builder_configuration_draft_v1!.policyKey).toBe(
      "builder_configuration_drafting_terra_medium_v1",
    );
    expect(runtime.tasks.builder_configuration_draft_v1!.inputSchema).toBe(
      builderConfigurationDraftTaskV1.inputSchema,
    );
    expect(runtime.tasks.builder_configuration_draft_v1!.outputSchema).toBe(
      builderConfigurationDraftTaskV1.outputSchema,
    );
    expect(runtime.tasks.builder_preorder_amendment_v1).not.toBe(
      builderPreorderAmendmentTaskV1,
    );
    expect(runtime.tasks.builder_preorder_amendment_v1!.policyKey).toBe(
      BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
    );
    expect(runtime.tasks.builder_preorder_amendment_v1!.inputSchema).toBe(
      builderPreorderAmendmentTaskV1.inputSchema,
    );
    expect(runtime.tasks.builder_preorder_amendment_v1!.outputSchema).toBe(
      builderPreorderAmendmentTaskV1.outputSchema,
    );
    expect(runtime.tasks.builder_location_creation_intent_v1!.policyKey).toBe(
      BUILDER_LOCATION_CREATION_TERRA_MEDIUM_POLICY_KEY,
    );
    expect(runtime.tasks.builder_location_creation_intent_v1).not.toBe(
      builderLocationCreationIntentTaskV1,
    );
    expect(runtime.tasks.builder_location_creation_intent_v1!.inputSchema).toBe(
      builderLocationCreationIntentTaskV1.inputSchema,
    );
    expect(
      runtime.tasks.builder_location_creation_intent_v1!.outputSchema,
    ).toBe(builderLocationCreationIntentTaskV1.outputSchema);
    expect(runtime.tasks.builder_record_creation_intent_v1!.policyKey).toBe(
      "builder_record_creation_intent_terra_medium_v1",
    );
    expect(runtime.tasks.builder_record_creation_intent_v1).not.toBe(
      builderRecordCreationIntentTaskV1,
    );
    expect(runtime.tasks.builder_record_creation_intent_v1!.inputSchema).toBe(
      builderRecordCreationIntentTaskV1.inputSchema,
    );
    expect(runtime.tasks.builder_record_creation_intent_v1!.outputSchema).toBe(
      builderRecordCreationIntentTaskV1.outputSchema,
    );
    expect(runtime.tasks.builder_record_update_intent_v1!.policyKey).toBe(
      BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY,
    );
    expect(runtime.tasks.builder_record_update_intent_v1).not.toBe(
      builderRecordUpdateIntentTaskV1,
    );
    expect(runtime.tasks.builder_record_update_intent_v1!.key).toBe(
      builderRecordUpdateIntentTaskV1.key,
    );
    expect(runtime.tasks.builder_record_update_intent_v1!.version).toBe(
      builderRecordUpdateIntentTaskV1.version,
    );
    expect(runtime.tasks.builder_record_update_intent_v1!.purposeLabel).toBe(
      builderRecordUpdateIntentTaskV1.purposeLabel,
    );
    expect(runtime.tasks.builder_record_update_intent_v1!.inputSchema).toBe(
      builderRecordUpdateIntentTaskV1.inputSchema,
    );
    expect(runtime.tasks.builder_record_update_intent_v1!.outputSchema).toBe(
      builderRecordUpdateIntentTaskV1.outputSchema,
    );
    expect(
      runtime.tasks.builder_record_update_intent_v1!.buildInstruction,
    ).toBe(builderRecordUpdateIntentTaskV1.buildInstruction);
    expect(runtime.tasks.builder_record_update_intent_v1!.validateOutput).toBe(
      builderRecordUpdateIntentTaskV1.validateOutput,
    );
    expect(runtime.tasks.builder_record_location_link_intent_v1).not.toBe(
      builderRecordLocationLinkIntentTaskV1,
    );
    expect(
      runtime.tasks.builder_record_location_link_intent_v1!.policyKey,
    ).toBe(BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY);
    expect(
      runtime.tasks.builder_record_location_link_intent_v1!.inputSchema,
    ).toBe(builderRecordLocationLinkIntentTaskV1.inputSchema);
    expect(
      runtime.tasks.builder_record_location_link_intent_v1!.outputSchema,
    ).toBe(builderRecordLocationLinkIntentTaskV1.outputSchema);
    expect(
      runtime.tasks.builder_record_location_link_intent_v1!.buildInstruction,
    ).toBe(builderRecordLocationLinkIntentTaskV1.buildInstruction);
    expect(
      runtime.tasks.builder_record_location_link_intent_v1!.validateOutput,
    ).toBe(builderRecordLocationLinkIntentTaskV1.validateOutput);
    expect(runtime.policies.builder_planning_terra_medium_v1).toBe(
      openAiBuilderPlanningPolicy,
    );
    expect(
      runtime.policies.builder_configuration_drafting_terra_medium_v1,
    ).toBe(openAiBuilderConfigurationDraftingPolicy);
    expect(
      runtime.policies[BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY],
    ).toBe(openAiBuilderPreorderAmendmentPolicy);
    expect(
      runtime.policies[BUILDER_LOCATION_CREATION_TERRA_MEDIUM_POLICY_KEY],
    ).toBe(openAiBuilderLocationCreationPolicy);
    expect(
      runtime.policies.builder_record_creation_intent_terra_medium_v1,
    ).toBe(openAiBuilderRecordCreationIntentPolicy);
    expect(
      runtime.policies[BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY],
    ).toBe(openAiBuilderRecordUpdateIntentPolicy);
    expect(
      runtime.policies[
        BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY
      ],
    ).toBe(openAiBuilderRecordLocationLinkIntentPolicy);
    expect(runtime.policies).not.toHaveProperty(
      BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY,
    );
    expect(runtime.providers.openai).toBe(provider);
    expect(runtime.providers.disabled?.key).toBe("disabled");

    const disabled = createBuilderAiRuntime({ AI_PROVIDER: "disabled" });
    expect(disabled.mode).toBe("disabled");
    expect(Object.keys(disabled.tasks)).toEqual([
      "builder_plan_v1",
      "builder_configuration_draft_v1",
      "builder_preorder_amendment_v1",
      "builder_location_creation_intent_v1",
      "builder_record_creation_intent_v1",
      "builder_record_update_intent_v1",
      "builder_record_location_link_intent_v1",
    ]);
    expect(disabled.tasks.builder_configuration_draft_v1!).toBe(
      builderConfigurationDraftTaskV1,
    );
    expect(disabled.tasks.builder_record_update_intent_v1).toBe(
      builderRecordUpdateIntentTaskV1,
    );
    expect(disabled.tasks.builder_record_location_link_intent_v1).toBe(
      builderRecordLocationLinkIntentTaskV1,
    );
    expect(
      disabled.tasks.builder_record_location_link_intent_v1!.policyKey,
    ).toBe("builder_record_location_link_intent_disabled_v1");
    expect(disabled.tasks.builder_record_update_intent_v1!.policyKey).toBe(
      BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY,
    );
    expect(
      disabled.policies[BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY],
    ).toBe(
      disabledExecutionPolicies[
        BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY
      ],
    );
    expect(disabled.policies).not.toHaveProperty(
      BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY,
    );
    expect(disabled.policies).not.toHaveProperty(
      BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY,
    );
    expect(Object.keys(disabled.providers)).toEqual(["disabled"]);
  });

  it("fails closed for invalid provider identity and never imports evaluation code", () => {
    expect(() =>
      createBuilderAiRuntime(
        { AI_PROVIDER: "openai", OPENAI_API_KEY: "test-key" },
        {
          createOpenAiProvider: () => ({
            key: "wrong-provider",
            generateStructured: vi.fn(),
          }),
        },
      ),
    ).toThrow(AiBuilderError);
    const builderRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "src",
      "ai",
      "builder",
    );
    const sourceText = fs
      .readdirSync(builderRoot)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => fs.readFileSync(path.join(builderRoot, file), "utf8"))
      .join("\n");
    expect(sourceText).not.toContain("src/ai/evaluation");
    expect(sourceText).not.toMatch(/from\s+["'].*evaluation/);
  });

  it("does not expose the qualified task through the global registry", async () => {
    const registry = await import("../src/ai/registry");
    expect(
      registry.registeredAiTasks.builder_configuration_draft_v1.policyKey,
    ).toBe("builder_configuration_drafting_disabled_v1");
    expect(
      registry.registeredAiTasks.builder_record_update_intent_v1.policyKey,
    ).toBe(BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY);
    expect(registry.aiExecutionPolicies).not.toHaveProperty(
      "builder_configuration_drafting_terra_medium_v1",
    );
    expect(registry.aiExecutionPolicies).not.toHaveProperty(
      BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY,
    );
    expect(
      registry.aiExecutionPolicies[
        BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY
      ],
    ).toBe(
      disabledExecutionPolicies[
        BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY
      ],
    );
  });
});

describe("Builder source boundaries", () => {
  it("contains no UI, route, direct provider, mutation, compiler, evaluation, or logging boundary", () => {
    const builderRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "src",
      "ai",
      "builder",
    );
    const sourceText = fs
      .readdirSync(builderRoot)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => fs.readFileSync(path.join(builderRoot, file), "utf8"))
      .join("\n");
    expect(sourceText).not.toMatch(/from\s+["'](?:next\/|react)/i);
    expect(sourceText).not.toMatch(/Server Action|use server|route\.ts/i);
    expect(sourceText).not.toMatch(/OpenAI.*SDK|new OpenAI/i);
    expect(sourceText).not.toMatch(/\bfetch\s*\(/i);
    expect(sourceText).not.toMatch(
      /\b(?:supabase|client|database|db)\.(?:from|rpc|insert|update|delete)\s*\(/i,
    );
    expect(sourceText).not.toMatch(
      /\b(RecordService|LocationService|validateAndApply|applyConfiguration|publishConfiguration)\b/i,
    );
    expect(
      fs.readFileSync(path.join(builderRoot, "service.ts"), "utf8"),
    ).not.toContain("draft-compiler/compiler");
    expect(sourceText).not.toMatch(/console\./i);
  });
});
