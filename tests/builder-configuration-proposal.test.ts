import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BUILDER_CONFIGURATION_PROPOSAL_TITLE,
  builderConfigurationProposalRequestSchema,
  builderConfigurationProposalResultSchema,
  type BuilderConfigurationProposalRequest,
} from "../src/ai/configuration-proposal/contracts";
import {
  BuilderConfigurationProposalError,
  builderConfigurationProposalErrorCodes,
} from "../src/ai/configuration-proposal/errors";
import {
  createBuilderConfigurationProposalService,
  type BuilderConfigurationProposalAdapter,
} from "../src/ai/configuration-proposal/service";
import type { AuthoritativeAiBusinessContext } from "../src/core/configuration/builder-context-source";
import {
  projectAiBusinessModelContext,
  type AiBusinessContextSource,
} from "../src/ai/context/projector";
import {
  ConfigurationDraftCompilerError,
  configurationDraftCompilerErrorCodes,
} from "../src/core/configuration/draft-compiler/errors";
import type { ConfigurationDraftCompilerInput } from "../src/core/configuration/draft-compiler/contracts";
import { ConfigurationChangeServiceError } from "../src/core/configuration/service";
import type { Database, Json, Tables } from "../src/db/supabase/database.types";

type Client = SupabaseClient<Database>;
type Source = AiBusinessContextSource;
type Proposal = Tables<"configuration_change_sets">;

const ids = {
  actor: "90000000-0000-4000-8000-000000000001",
  business: "90000000-0000-4000-8000-000000000002",
  version: "90000000-0000-4000-8000-000000000003",
  proposal: "90000000-0000-4000-8000-000000000004",
  otherActor: "90000000-0000-4000-8000-000000000005",
  otherBusiness: "90000000-0000-4000-8000-000000000006",
} as const;

function emptySnapshot() {
  return {
    schema_version: 1 as const,
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

function source(overrides: Partial<Source> = {}): Source {
  return {
    business: {
      name: "Example Business",
      businessType: "catering",
      timezone: "Europe/London",
    },
    access: {
      role: "owner",
      capabilities: ["manage_configuration"],
    },
    activeConfiguration: {
      versionNumber: 1,
      revision: 1,
      snapshot: emptySnapshot(),
    },
    locations: [],
    ...overrides,
  };
}

function authoritative(
  contextSource: Source = source(),
  executionContext: { businessId: string; actorId: string } = {
    businessId: ids.business,
    actorId: ids.actor,
  },
  currentness: { baseVersionId: string; headRevision: number } = {
    baseVersionId: ids.version,
    headRevision: 1,
  },
): AuthoritativeAiBusinessContext {
  return {
    executionContext,
    currentness,
    source: contextSource,
  };
}

function readyPlan() {
  return {
    schema_version: 1 as const,
    state: "ready" as const,
    understanding: "The Business needs a new enquiry setup.",
    assumptions: [],
    plan: {
      outcome: "The Business can review new enquiries.",
      concepts: [
        {
          reference: "concept_1",
          label: "Catering Enquiry",
          disposition: "new" as const,
          purpose: "Capture a new catering enquiry.",
        },
      ],
      user_journeys: [],
      steps: [
        {
          reference: "step_1",
          sequence: 1,
          summary: "Define the Catering Enquiry Object.",
          dependencies: [],
          affected_concepts: ["concept_1"],
          existing_object_keys: [],
          location_references: [],
          materiality: "low" as const,
          requires_owner_confirmation: true as const,
          lane: "configuration" as const,
          category: "define_object" as const,
        },
      ],
    },
    unsupported_requirements: [],
  };
}

function draft() {
  return {
    schema_version: 1 as const,
    summary: "A bounded enquiry configuration draft.",
    objects: [
      {
        reference: "draft_object_1",
        concept_reference: "concept_1",
        source_step_references: ["step_1"],
        singular_label: "Catering Enquiry",
        plural_label: "Catering Enquiries",
        description: "A catering enquiry submitted by a prospective customer.",
      },
    ],
    fields: [],
    relationships: [],
    views: [],
    forms: [],
    pages: [],
  };
}

function handoff(
  contextSource: Source = source(),
  overrides: Partial<BuilderConfigurationProposalRequest> = {},
): BuilderConfigurationProposalRequest {
  const projection = projectAiBusinessModelContext(contextSource).modelContext;
  return {
    businessId: ids.business,
    expectedCurrentness: {
      baseVersionId: ids.version,
      headRevision: 1,
    },
    taskInput: {
      schema_version: 1,
      owner_request:
        "Create a Catering Enquiry with Company name, Event date, Number of guests, Budget and Notes.",
      business_context: projection,
      ready_plan: readyPlan(),
    },
    draft: draft(),
    ...overrides,
  };
}

const compiledOperations = [
  {
    op: "set_object" as const,
    key: "catering_enquiry",
    singular_label: "Catering Enquiry",
    plural_label: "Catering Enquiries",
    description: "A catering enquiry submitted by a prospective customer.",
    icon: null,
    is_active: true,
  },
];

function proposal(
  operations: Json = compiledOperations,
  overrides: Partial<Proposal> = {},
): Proposal {
  return {
    id: ids.proposal,
    business_id: ids.business,
    kind: "change",
    status: "proposed",
    title: BUILDER_CONFIGURATION_PROPOSAL_TITLE,
    description: null,
    base_version_id: ids.version,
    base_head_revision: 1,
    requested_by: ids.actor,
    operations_schema_version: 1,
    operations_json: operations,
    id_allocations_json: {},
    display_context_json: { schema_version: 1, locations: {} },
    candidate_snapshot_json: emptySnapshot(),
    candidate_checksum: "a".repeat(64),
    semantic_diff_json: {
      schema_version: 1,
      counts: { created: 1, updated: 0, archived: 0, restored: 0 },
      changes: [],
    },
    rollback_target_version_id: null,
    validated_at: null,
    validated_by: null,
    validation_result_json: null,
    applied_at: null,
    applied_by: null,
    applied_version_id: null,
    closed_at: null,
    closed_by: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function compilerOutput() {
  return { schema_version: 1 as const, operations: compiledOperations };
}

function setup(
  overrides: {
    first?: AuthoritativeAiBusinessContext;
    second?: AuthoritativeAiBusinessContext;
    compile?: (input: ConfigurationDraftCompilerInput) => {
      schema_version: 1;
      operations: typeof compiledOperations;
    };
    proposalResult?: Proposal;
    proposalError?: unknown;
  } = {},
) {
  const first = overrides.first ?? authoritative();
  const second = overrides.second ?? first;
  const loadContext = vi
    .fn<
      (
        client: Client,
        input: { businessId: string },
      ) => Promise<AuthoritativeAiBusinessContext>
    >()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second);
  const compileDraft = vi.fn(overrides.compile ?? (() => compilerOutput()));
  const proposeChangeSet = vi.fn(async () => {
    if (overrides.proposalError) {
      throw overrides.proposalError;
    }
    return overrides.proposalResult ?? proposal();
  });
  const adapter: BuilderConfigurationProposalAdapter = { proposeChangeSet };
  const createProposalAdapter = vi.fn(() => adapter);
  const service = createBuilderConfigurationProposalService({
    loadContext,
    compileDraft,
    createProposalAdapter,
  });
  return {
    service,
    loadContext,
    compileDraft,
    createProposalAdapter,
    proposeChangeSet,
    client: {} as Client,
  };
}

describe("authenticated configuration proposal orchestration", () => {
  it("parses the strict handoff and rejects untrusted proposal fields", () => {
    const input = handoff();
    expect(builderConfigurationProposalRequestSchema.parse(input)).toEqual(
      input,
    );

    for (const invalid of [
      { ...input, actorId: ids.actor },
      { ...input, title: "caller supplied title" },
      { ...input, description: "caller supplied description" },
      { ...input, operations: compiledOperations },
      { ...input, proposal: { status: "proposed" } },
      {
        ...input,
        expectedCurrentness: {
          ...input.expectedCurrentness,
          candidate: {},
        },
      },
      { ...input, businessContext: input.taskInput.business_context },
    ]) {
      expect(
        builderConfigurationProposalRequestSchema.safeParse(invalid).success,
      ).toBe(false);
    }

    expect(builderConfigurationProposalErrorCodes).toEqual([
      "ai_configuration_proposal_request_invalid",
      "ai_configuration_proposal_context_stale",
      "ai_configuration_proposal_compile_failed",
      "ai_configuration_proposal_no_changes",
      "ai_configuration_proposal_failed",
    ]);
  });

  it("returns only a frozen bounded result and does not mutate the handoff", async () => {
    const input = handoff();
    const before = structuredClone(input);
    const { service, client } = setup();

    const result = await service.propose(client, input);

    expect(result).toEqual({
      schema_version: 1,
      proposal_id: ids.proposal,
      status: "proposed",
      base_version_id: ids.version,
      base_head_revision: 1,
      operation_count: 1,
    });
    expect(Object.keys(result)).toEqual([
      "schema_version",
      "proposal_id",
      "status",
      "base_version_id",
      "base_head_revision",
      "operation_count",
    ]);
    expect(builderConfigurationProposalResultSchema.parse(result)).toEqual(
      result,
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(input).toEqual(before);
  });

  it("performs two reads, one compile, and exactly one proposal call", async () => {
    const events: string[] = [];
    const input = handoff();
    const first = authoritative();
    const second = authoritative();
    const compileDraft = vi.fn(
      (compilerInput: ConfigurationDraftCompilerInput) => {
        events.push("compile");
        expect(compilerInput.taskInput).toEqual(input.taskInput);
        expect(compilerInput.draft).toEqual(input.draft);
        expect(compilerInput.snapshot).toBe(
          first.source.activeConfiguration.snapshot,
        );
        return compilerOutput();
      },
    );
    const loadContext = vi
      .fn<
        (
          client: Client,
          input: { businessId: string },
        ) => Promise<AuthoritativeAiBusinessContext>
      >()
      .mockImplementationOnce(async () => {
        events.push("first-context");
        return first;
      })
      .mockImplementationOnce(async () => {
        events.push("second-context");
        return second;
      });
    const proposeChangeSet = vi.fn(async (proposalInput) => {
      events.push("proposal");
      expect(proposalInput).toEqual({
        expectedBaseVersionId: ids.version,
        expectedHeadRevision: 1,
        title: BUILDER_CONFIGURATION_PROPOSAL_TITLE,
        description: null,
        operations: compiledOperations,
      });
      return proposal();
    });
    const adapter: BuilderConfigurationProposalAdapter = { proposeChangeSet };
    const createProposalAdapter = vi.fn(() => adapter);
    const service = createBuilderConfigurationProposalService({
      loadContext,
      compileDraft,
      createProposalAdapter,
    });

    await service.propose({} as Client, input);

    expect(events).toEqual([
      "first-context",
      "compile",
      "second-context",
      "proposal",
    ]);
    expect(loadContext).toHaveBeenCalledTimes(2);
    expect(compileDraft).toHaveBeenCalledTimes(1);
    expect(createProposalAdapter).toHaveBeenCalledWith(
      {},
      second.executionContext,
    );
    expect(proposeChangeSet).toHaveBeenCalledTimes(1);
    expect(Object.keys(adapter)).toEqual(["proposeChangeSet"]);
  });

  it.each(["baseVersionId", "headRevision"] as const)(
    "rejects a stale expected %s before compilation",
    async (key) => {
      const input = handoff({
        ...source(),
      });
      if (key === "baseVersionId") {
        input.expectedCurrentness.baseVersionId = ids.otherBusiness;
      } else {
        input.expectedCurrentness.headRevision = 2;
      }
      const { service, compileDraft, proposeChangeSet, client } = setup();

      await expect(service.propose(client, input)).rejects.toMatchObject({
        code: "ai_configuration_proposal_context_stale",
      });
      expect(compileDraft).not.toHaveBeenCalled();
      expect(proposeChangeSet).not.toHaveBeenCalled();
    },
  );

  it.each([
    "business metadata",
    "Location metadata",
    "role/capability projection",
    "configuration projection",
  ])("rejects %s drift before compilation", async (kind) => {
    const original = source();
    const changed = structuredClone(original) as Source;
    if (kind === "business metadata") {
      changed.business.name = "Changed Business";
    } else if (kind === "Location metadata") {
      changed.locations = [
        {
          reference: "a0000000-0000-4000-8000-000000000001",
          name: "Bedford",
          timezone: "Europe/London",
          isActive: true,
        },
      ];
    } else if (kind === "role/capability projection") {
      changed.access.role = "admin";
    } else {
      changed.activeConfiguration.revision = 2;
    }
    const first = authoritative(changed);
    const { service, compileDraft, proposeChangeSet, client } = setup({
      first,
    });

    await expect(
      service.propose(client, handoff(original)),
    ).rejects.toMatchObject({
      code: "ai_configuration_proposal_context_stale",
    });
    expect(compileDraft).not.toHaveBeenCalled();
    expect(proposeChangeSet).not.toHaveBeenCalled();
  });

  it.each([
    "Business ID",
    "actor ID",
    "base version",
    "head revision",
    "Business metadata",
    "Location data",
    "model context",
  ])(
    "rejects second-read %s drift without recompile or retry",
    async (kind) => {
      const first = authoritative();
      const secondSource = structuredClone(first.source) as Source;
      const secondExecutionContext = { ...first.executionContext };
      const secondCurrentness = { ...first.currentness };
      if (kind === "Business ID") {
        secondExecutionContext.businessId = ids.otherBusiness;
      } else if (kind === "actor ID") {
        secondExecutionContext.actorId = ids.otherActor;
      } else if (kind === "base version") {
        secondCurrentness.baseVersionId = ids.otherBusiness;
      } else if (kind === "head revision") {
        secondCurrentness.headRevision = 2;
      } else if (kind === "Business metadata") {
        secondSource.business.name = "Changed Business";
      } else if (kind === "Location data") {
        secondSource.locations = [
          {
            reference: "a0000000-0000-4000-8000-000000000001",
            name: "Bedford",
            timezone: "Europe/London",
            isActive: true,
          },
        ];
      } else {
        secondSource.business.timezone = "Europe/Dublin";
      }
      const second = authoritative(
        secondSource,
        secondExecutionContext,
        secondCurrentness,
      );
      const { service, loadContext, compileDraft, proposeChangeSet, client } =
        setup({ first, second });

      await expect(service.propose(client, handoff())).rejects.toMatchObject({
        code: "ai_configuration_proposal_context_stale",
      });
      expect(loadContext).toHaveBeenCalledTimes(2);
      expect(compileDraft).toHaveBeenCalledTimes(1);
      expect(proposeChangeSet).not.toHaveBeenCalled();
    },
  );

  it("maps compiler failures without exposing diagnostics", async () => {
    const marker = "raw-compiler-diagnostic-marker";
    const compile = () => {
      throw new ConfigurationDraftCompilerError(
        configurationDraftCompilerErrorCodes[0],
      );
    };
    const { service, proposeChangeSet, client } = setup({ compile });

    const error = await service
      .propose(client, handoff())
      .catch((cause) => cause);
    expect(error).toBeInstanceOf(BuilderConfigurationProposalError);
    expect(error).toMatchObject({
      code: "ai_configuration_proposal_compile_failed",
    });
    expect(JSON.stringify(error)).not.toContain(marker);
    expect(JSON.stringify(error)).not.toContain("Catering Enquiry");
    expect(proposeChangeSet).not.toHaveBeenCalled();
  });

  it.each([
    ["configuration_proposal_stale", "ai_configuration_proposal_context_stale"],
    [
      "configuration_proposal_no_changes",
      "ai_configuration_proposal_no_changes",
    ],
    ["configuration_request_failed", "ai_configuration_proposal_failed"],
  ] as const)("maps M5 %s safely", async (m5Code, expectedCode) => {
    const m5Error = new ConfigurationChangeServiceError("internal M5 detail", {
      message: m5Code,
    });
    const { service, client } = setup({ proposalError: m5Error });

    await expect(service.propose(client, handoff())).rejects.toMatchObject({
      code: expectedCode,
    });
  });

  it("rejects an inconsistent M5 success response", async () => {
    const { service, client, proposeChangeSet } = setup({
      proposalResult: proposal(compiledOperations, {
        requested_by: ids.otherActor,
      }),
    });

    await expect(service.propose(client, handoff())).rejects.toMatchObject({
      code: "ai_configuration_proposal_failed",
    });
    expect(proposeChangeSet).toHaveBeenCalledTimes(1);
  });

  it("propagates the established authenticated context error unchanged", async () => {
    const contextError = new Error("context-safe-error");
    const loadContext = vi.fn(async () => {
      throw contextError;
    });
    const service = createBuilderConfigurationProposalService({ loadContext });

    await expect(service.propose({} as Client, handoff())).rejects.toBe(
      contextError,
    );
  });

  it("keeps the public error finite and safe", () => {
    const error = new BuilderConfigurationProposalError(
      "ai_configuration_proposal_request_invalid",
      { cause: { marker: "private-input" } },
    );
    expect(error.toJSON()).toEqual({
      code: "ai_configuration_proposal_request_invalid",
      message: "The configuration proposal request was not valid.",
    });
    expect(JSON.stringify(error)).not.toContain("private-input");
  });

  it("keeps the proposal boundary free of providers, lifecycle methods, routes and mutation code", () => {
    const repositoryRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    const proposalSource = fs.readFileSync(
      path.join(repositoryRoot, "src/ai/configuration-proposal/service.ts"),
      "utf8",
    );
    expect(proposalSource).not.toMatch(
      /providers|registry|policies|business-execution|accounting|createClient|service_role|fetch\(|validateChangeSet|applyChangeSet|prepareRollback|abandonChangeSet|crypto\.randomUUID|set_preorder_experience|next\/|react/i,
    );
    expect(
      fs.readFileSync(
        path.join(repositoryRoot, "src/ai/configuration-drafting/task.ts"),
        "utf8",
      ),
    ).not.toContain("draft-compiler");
    expect(
      fs.readFileSync(
        path.join(
          repositoryRoot,
          "src/core/configuration/draft-compiler/compiler.ts",
        ),
        "utf8",
      ),
    ).not.toMatch(
      /loadAuthoritativeAiBusinessContext|ConfigurationChangeService/,
    );
  });
});
