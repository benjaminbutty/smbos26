import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BUILDER_UNSUPPORTED_MESSAGES,
  builderOrchestrationResultSchema,
} from "../src/ai/builder/contracts";
import { aiBuilderErrorCodes, AiBuilderError } from "../src/ai/builder/errors";
import {
  builderConfigurationProposalErrorCodes,
  BuilderConfigurationProposalError,
} from "../src/ai/configuration-proposal/errors";
import {
  builderPreorderAmendmentProposalErrorCodes,
  BuilderPreorderAmendmentProposalError,
} from "../src/ai/preorder-amendment/errors";
import { createRecordConfirmationTokenService } from "../src/ai/builder/record-confirmation-token";
import {
  aiBusinessContextErrorCodes,
  AiBusinessContextError,
} from "../src/ai/context/errors";
import { aiExecutionErrorCodes, AiExecutionError } from "../src/ai/errors";
import {
  BuilderDisabledUi,
  BuilderResultPanel,
  BuilderUi,
} from "../src/components/builder-ui";
import {
  BUILDER_INITIAL_STATE,
  BUILDER_UI_INPUT_INVALID_MESSAGE,
  BUILDER_UI_UNAVAILABLE_MESSAGES,
  builderUiStateSchema,
  freezeBuilderUiState,
  type BuilderResultUiState,
  type BuilderUiState,
} from "../src/components/builder-ui-state";
import {
  invalidBuilderInputState,
  mapBuilderActionError,
  mapBuilderOrchestrationResult,
  parseBuilderOwnerRequest,
  parseBuilderRouteSlug,
} from "../src/app/app/[businessSlug]/builder/action-service";
import { ConfigurationActionNotice } from "../src/components/configuration-action-ui";
import { configurationActionNoticeSchema } from "../src/core/configuration/action-notices";

const proposalId = "10000000-0000-4000-8000-000000000001";
const baseVersionId = "10000000-0000-4000-8000-000000000002";

function clarificationResult() {
  return {
    schema_version: 1 as const,
    state: "needs_clarification" as const,
    clarification: {
      schema_version: 1 as const,
      state: "needs_clarification" as const,
      understanding: '<script>alert("understanding")</script>',
      known_requirements: ["The owner needs a new enquiry experience."],
      assumptions: [
        {
          reference: "assumption_1",
          statement: "The team will review enquiries internally.",
          impact: "high" as const,
          requires_owner_confirmation: true,
        },
      ],
      questions: [
        {
          reference: "question_1",
          question: 'Use <a href="javascript:bad">event details</a>.',
          reason: "The fields depend on this choice.",
          response_style: "single_choice" as const,
          options: ["Event details", "Contact details"],
        },
        {
          reference: "question_2",
          question: "What else should the team know?",
          reason: "A free-text answer can capture the remaining detail.",
          response_style: "free_text" as const,
        },
      ],
      unsupported_requirements: [
        {
          reference: "unsupported_1",
          requirement: "Send a weekly automated email.",
          reason_code: "workflow_unavailable" as const,
          explanation: "Automated workflows are not available in this phase.",
        },
      ],
    },
  };
}

function proposedResult() {
  return {
    schema_version: 1 as const,
    state: "proposed" as const,
    proposal_id: proposalId,
    status: "proposed" as const,
    base_version_id: baseVersionId,
    base_head_revision: 4,
    operation_count: 3,
    summary: "A bounded enquiry setup is ready for review.",
  };
}

function stateForError(
  error: unknown,
): Exclude<BuilderUiState, { state: "idle" }> {
  const mapped = mapBuilderActionError(error);
  if (mapped.kind !== "state") {
    throw new Error("Expected a mapped Builder UI state.");
  }
  return mapped.state;
}

function unavailableStateForError(
  error: unknown,
): Extract<BuilderResultUiState, { state: "unavailable" }> {
  const state = stateForError(error);
  if (state.state !== "unavailable") {
    throw new Error("Expected an unavailable Builder UI state.");
  }
  return state;
}

describe("Phase 8C Builder UI state and presentation boundary", () => {
  it("has a strict, bounded state contract with no request or provider fields", () => {
    expect(builderUiStateSchema.parse(BUILDER_INITIAL_STATE)).toEqual(
      BUILDER_INITIAL_STATE,
    );
    expect(
      builderUiStateSchema.safeParse({
        state: "input_invalid",
        message: BUILDER_UI_INPUT_INVALID_MESSAGE,
        ownerRequest: "secret request",
      }).success,
    ).toBe(false);
    expect(
      builderUiStateSchema.safeParse({
        state: "proposed",
        proposal_id: "not-a-uuid",
        summary: "A proposal",
        operation_count: 1,
      }).success,
    ).toBe(false);
    expect(
      builderUiStateSchema.safeParse({
        state: "proposed",
        proposal_id: proposalId,
        summary: "A proposal",
        operation_count: 101,
      }).success,
    ).toBe(false);
    expect(
      builderUiStateSchema.safeParse({
        state: "unavailable",
        reason: "ai_disabled",
        message: "provider details",
      }).success,
    ).toBe(false);
    expect(
      builderUiStateSchema.safeParse({
        state: "unsupported",
        message: "x".repeat(241),
      }).success,
    ).toBe(false);
  });

  it("maps clarification output into owner-facing fields and strips local references", () => {
    const mapped = mapBuilderOrchestrationResult(clarificationResult());
    if (mapped.state !== "needs_clarification") {
      throw new Error("Expected a clarification state.");
    }
    expect(mapped).toEqual({
      state: "needs_clarification",
      understanding: '<script>alert("understanding")</script>',
      known_requirements: ["The owner needs a new enquiry experience."],
      assumptions: [
        {
          statement: "The team will review enquiries internally.",
          requires_owner_confirmation: true,
        },
      ],
      questions: [
        {
          question: 'Use <a href="javascript:bad">event details</a>.',
          reason: "The fields depend on this choice.",
          response_style: "single_choice",
          options: ["Event details", "Contact details"],
        },
        {
          question: "What else should the team know?",
          reason: "A free-text answer can capture the remaining detail.",
          response_style: "free_text",
          options: [],
        },
      ],
      unsupported_requirements: [
        {
          requirement: "Send a weekly automated email.",
          explanation: "Automated workflows are not available in this phase.",
        },
      ],
    });
    expect(JSON.stringify(mapped)).not.toMatch(
      /question_1|question_2|assumption_1|unsupported_1|workflow_unavailable|impact|reason_code|provider/i,
    );
    expect(Object.isFrozen(mapped)).toBe(true);
    expect(Object.isFrozen(mapped.questions)).toBe(true);
    expect(builderUiStateSchema.parse(mapped)).toEqual(mapped);
  });

  it("maps unsupported and proposed results to only the bounded handoff fields", () => {
    const unsupported = mapBuilderOrchestrationResult({
      schema_version: 1,
      state: "unsupported",
      reason_code: "operational_plan_unavailable",
      message: BUILDER_UNSUPPORTED_MESSAGES.operational_plan_unavailable,
    });
    expect(unsupported).toEqual({
      state: "unsupported",
      message: BUILDER_UNSUPPORTED_MESSAGES.operational_plan_unavailable,
    });

    const proposed = mapBuilderOrchestrationResult(proposedResult());
    expect(proposed).toEqual({
      state: "proposed",
      proposal_id: proposalId,
      summary: "A bounded enquiry setup is ready for review.",
      operation_count: 3,
    });
    expect(JSON.stringify(proposed)).not.toMatch(
      /business|base_version|head_revision|status|operations|provider|accounting/i,
    );
    expect(
      builderOrchestrationResultSchema.safeParse(proposedResult()).success,
    ).toBe(true);
  });

  it("maps generic Record confirmation to a signed token and owner-readable fields", () => {
    const state = mapBuilderOrchestrationResult(
      {
        schema_version: 1,
        state: "record_confirmation",
        intent_schema_version: 1,
        object_key: "product",
        object_label: "Product",
        explicit_fields: [
          {
            field_key: "name",
            label: "Name",
            field_type: "short_text",
            value: "Afternoon Tea Box",
            formatted_value: "Afternoon Tea Box",
            source: "explicit",
          },
          {
            field_key: "price",
            label: "Price",
            field_type: "currency",
            value: 30,
            formatted_value: "£30.00",
            source: "explicit",
          },
        ],
        default_fields: [
          {
            field_key: "status",
            label: "Status",
            field_type: "status",
            value: "Active",
            formatted_value: "Active",
            source: "default",
          },
        ],
        field_values: [
          {
            field_key: "name",
            field_type: "short_text",
            string_value: "Afternoon Tea Box",
          },
          { field_key: "price", field_type: "currency", number_value: 30 },
        ],
        base_version_id: baseVersionId,
        head_revision: 4,
        object_schema_digest: "a".repeat(64),
        record_state_digest: "b".repeat(64),
      },
      {
        businessId: "10000000-0000-4000-8000-000000000003",
        actorId: "10000000-0000-4000-8000-000000000004",
        recordTokenService: createRecordConfirmationTokenService({
          secret: "record-confirmation-test-secret-0123456789",
          now: () => 1_000,
        }),
      },
    );
    expect(state).toMatchObject({
      state: "record_confirmation",
      object_label: "Product",
      explicit_fields: [
        { label: "Name", formatted_value: "Afternoon Tea Box" },
        { label: "Price", formatted_value: "£30.00" },
      ],
      default_fields: [{ label: "Status", formatted_value: "Active" }],
    });
    expect(JSON.stringify(state)).not.toContain("field_key");
    expect(JSON.stringify(state)).not.toContain("base_version");
    expect(JSON.stringify(state)).not.toContain("10000000-0000-4000");
    const html = renderToStaticMarkup(
      createElement(BuilderResultPanel, {
        businessSlug: "bedford-bakery-demo",
        state,
      }),
    );
    expect(html).toContain("Add Product");
    expect(html).toContain("Afternoon Tea Box");
    expect(html).toContain("£30.00");
    expect(html).toContain("Active");
    expect(html).toContain("Confirm and create");
    expect(html).toContain('name="confirmationKind" value="create_record"');
    expect(html).not.toContain("field_key");
  });

  it("keeps free-text questions optionless and freezes every returned state", () => {
    const state = invalidBuilderInputState();
    expect(state).toEqual({
      state: "input_invalid",
      message: BUILDER_UI_INPUT_INVALID_MESSAGE,
    });
    expect(Object.isFrozen(state)).toBe(true);
    const proposed = freezeBuilderUiState({
      state: "proposed",
      proposal_id: proposalId,
      summary: "Prepared",
      operation_count: 1,
    });
    expect(Object.isFrozen(proposed)).toBe(true);
    expect(
      builderUiStateSchema.safeParse({
        state: "needs_clarification",
        understanding: "More detail is needed.",
        known_requirements: [],
        assumptions: [],
        questions: [
          {
            question: "What should be captured?",
            reason: "The form needs a bounded scope.",
            response_style: "free_text",
            options: ["must be empty"],
          },
        ],
        unsupported_requirements: [],
      }).success,
    ).toBe(false);
  });

  it("maps every established safe error category and rethrows unexpected errors", () => {
    const builderReasons = new Map<
      (typeof aiBuilderErrorCodes)[number],
      string
    >([
      ["ai_builder_request_invalid", "input_invalid"],
      ["ai_builder_context_stale", "stale"],
      ["ai_builder_runtime_invalid", "temporarily_unavailable"],
      ["ai_builder_internal_failed", "could_not_prepare"],
    ]);
    for (const code of aiBuilderErrorCodes) {
      const state = stateForError(new AiBuilderError(code));
      if (code === "ai_builder_request_invalid") {
        expect(state.state).toBe("input_invalid");
      } else {
        if (state.state !== "unavailable") {
          throw new Error("Expected an unavailable Builder UI state.");
        }
        expect(state.reason).toBe(builderReasons.get(code));
      }
    }

    const executionReasons = new Map<
      (typeof aiExecutionErrorCodes)[number],
      string
    >([
      ["ai_disabled", "ai_disabled"],
      ["ai_budget_exceeded", "budget_reached"],
      ["ai_rate_limited", "temporarily_unavailable"],
      ["ai_provider_unavailable", "temporarily_unavailable"],
      ["ai_timeout", "temporarily_unavailable"],
      ["ai_attempts_exhausted", "temporarily_unavailable"],
      ["ai_accounting_unavailable", "temporarily_unavailable"],
      ["ai_accounting_failed", "temporarily_unavailable"],
      ["ai_input_invalid", "could_not_prepare"],
      ["ai_input_too_large", "could_not_prepare"],
      ["ai_output_invalid", "could_not_prepare"],
      ["ai_refused", "could_not_prepare"],
      ["ai_incomplete", "could_not_prepare"],
      ["ai_content_filtered", "could_not_prepare"],
      ["ai_execution_failed", "could_not_prepare"],
      ["ai_task_not_found", "could_not_prepare"],
    ]);
    for (const code of aiExecutionErrorCodes) {
      expect(unavailableStateForError(new AiExecutionError(code)).reason).toBe(
        executionReasons.get(code),
      );
    }

    const proposalReasons = new Map<
      (typeof builderConfigurationProposalErrorCodes)[number],
      string
    >([
      ["ai_configuration_proposal_request_invalid", "could_not_prepare"],
      ["ai_configuration_proposal_context_stale", "stale"],
      ["ai_configuration_proposal_compile_failed", "could_not_prepare"],
      ["ai_configuration_proposal_no_changes", "nothing_to_propose"],
      ["ai_configuration_proposal_failed", "could_not_prepare"],
    ]);
    for (const code of builderConfigurationProposalErrorCodes) {
      expect(
        unavailableStateForError(new BuilderConfigurationProposalError(code))
          .reason,
      ).toBe(proposalReasons.get(code));
    }

    const preorderAmendmentReasons = new Map<
      (typeof builderPreorderAmendmentProposalErrorCodes)[number],
      string
    >([
      ["ai_preorder_amendment_request_invalid", "could_not_prepare"],
      ["ai_preorder_amendment_context_stale", "stale"],
      ["ai_preorder_amendment_no_changes", "nothing_to_propose"],
      ["ai_preorder_amendment_failed", "could_not_prepare"],
    ]);
    for (const code of builderPreorderAmendmentProposalErrorCodes) {
      expect(
        unavailableStateForError(
          new BuilderPreorderAmendmentProposalError(code),
        ).reason,
      ).toBe(preorderAmendmentReasons.get(code));
    }

    const contextReasons = new Map<
      (typeof aiBusinessContextErrorCodes)[number],
      string
    >([
      ["ai_context_too_large", "temporarily_unavailable"],
      ["ai_context_failed", "temporarily_unavailable"],
      ["ai_context_inconsistent", "could_not_prepare"],
    ]);
    for (const code of aiBusinessContextErrorCodes) {
      const mapped = mapBuilderActionError(new AiBusinessContextError(code));
      if (
        code === "ai_context_unauthorized" ||
        code === "ai_context_not_found"
      ) {
        expect(mapped).toEqual({ kind: "not_found" });
      } else {
        expect(mapped).toMatchObject({
          kind: "state",
          state: { reason: contextReasons.get(code) },
        });
      }
    }

    const unexpected = new Error("secret unexpected cause");
    expect(mapBuilderActionError(unexpected)).toEqual({
      kind: "unexpected",
      error: unexpected,
    });
    expect(
      JSON.stringify(
        stateForError(
          new AiExecutionError("ai_timeout", {
            cause: { provider: "secret provider body" },
          }),
        ),
      ),
    ).not.toContain("secret provider body");
    expect(BUILDER_UI_UNAVAILABLE_MESSAGES.ai_disabled).toBe(
      "Builder is enabled for this Business, but AI is currently unavailable in this environment.",
    );
  });

  it("keeps Business enablement distinct from server AI availability", () => {
    const disabledBusinessHtml = renderToStaticMarkup(
      createElement(BuilderDisabledUi, {
        enableAction: async () => {},
      }),
    );
    const serverAiUnavailable = mapBuilderActionError(
      new AiExecutionError("ai_disabled"),
    );

    expect(disabledBusinessHtml).toContain(
      "Builder is currently off for this Business.",
    );
    expect(disabledBusinessHtml).toContain("Enable Builder");
    expect(disabledBusinessHtml).not.toContain(
      "AI is currently unavailable in this environment.",
    );
    expect(serverAiUnavailable).toEqual({
      kind: "state",
      state: {
        state: "unavailable",
        reason: "ai_disabled",
        message:
          "Builder is enabled for this Business, but AI is currently unavailable in this environment.",
      },
    });
  });

  it("parses only the route slug and owner request boundary", () => {
    expect(parseBuilderRouteSlug("bedford-bakery-demo")).toBe(
      "bedford-bakery-demo",
    );
    expect(parseBuilderRouteSlug("../../other-business")).toBeNull();
    expect(parseBuilderOwnerRequest(new FormData())).toEqual({
      success: false,
    });

    const form = new FormData();
    form.set("ownerRequest", "  Create a form.  ");
    form.set("businessId", "forged-business");
    form.set("actorId", "forged-actor");
    expect(parseBuilderOwnerRequest(form)).toEqual({
      success: true,
      ownerRequest: "Create a form.",
    });

    const tooLong = new FormData();
    tooLong.set("ownerRequest", "x".repeat(4_001));
    expect(parseBuilderOwnerRequest(tooLong)).toEqual({ success: false });
  });

  it("renders owner-facing content, escaped model text, and a deliberate Changes handoff", () => {
    const action = async () => BUILDER_INITIAL_STATE;
    const initialHtml = renderToStaticMarkup(
      createElement(BuilderUi, {
        action,
        businessSlug: "bedford-bakery-demo",
      }),
    );
    expect(initialHtml).toContain("Business Builder");
    expect(initialHtml).toContain("What would you like your business to do?");
    expect(initialHtml).toContain(
      "not individual customer or staff information",
    );
    expect(initialHtml).toContain("not stored as a Builder conversation");
    expect(initialHtml).toContain('name="ownerRequest"');
    expect(initialHtml).toContain('maxLength="4000"');
    expect(initialHtml).toContain("0 / 4,000 characters");
    expect(initialHtml).toContain("Prepare request");
    expect(initialHtml).toContain("Ideas to get started");
    const builderUiSource = readFileSync(
      join(process.cwd(), "src/components/builder-ui.tsx"),
      "utf8",
    );
    const resultPosition = builderUiSource.indexOf("<BuilderResultPanel");
    const examplesPosition = builderUiSource.indexOf(
      'aria-labelledby="builder-examples-heading"',
    );
    expect(resultPosition).toBeGreaterThanOrEqual(0);
    expect(resultPosition).toBeLessThan(examplesPosition);

    const clarificationHtml = renderToStaticMarkup(
      createElement(BuilderResultPanel, {
        businessSlug: "bedford-bakery-demo",
        state: mapBuilderOrchestrationResult(clarificationResult()),
      }),
    );
    expect(clarificationHtml).toContain("A little more detail will help");
    expect(clarificationHtml).toContain("Event details");
    expect(clarificationHtml).toContain("Contact details");
    expect(clarificationHtml).toContain("Free-text answer");
    expect(clarificationHtml).toContain(
      "Add these details to your request above",
    );
    expect(clarificationHtml).toContain("&lt;script&gt;");
    expect(clarificationHtml).toContain(
      "&lt;a href=&quot;javascript:bad&quot;&gt;",
    );
    expect(clarificationHtml).not.toContain("<script>");
    expect(clarificationHtml).not.toContain('<a href="javascript:bad"');
    expect(clarificationHtml).not.toContain("question_1");
    expect(clarificationHtml).toContain('role="status"');

    const proposedHtml = renderToStaticMarkup(
      createElement(BuilderResultPanel, {
        businessSlug: "bedford-bakery-demo",
        state: mapBuilderOrchestrationResult(proposedResult()),
      }),
    );
    expect(proposedHtml).toContain(
      "A bounded enquiry setup is ready for review.",
    );
    expect(proposedHtml).toContain("3 configuration changes");
    expect(proposedHtml).toContain(
      `/app/bedford-bakery-demo/changes/${proposalId}?notice=builder_prepared`,
    );
    expect(proposedHtml).toContain("Nothing is live yet");
    expect(proposedHtml).toContain("Review proposed change");
    expect(proposedHtml).not.toMatch(/<button[^>]*>[^<]*(Validate|Apply)/i);

    const unsupportedHtml = renderToStaticMarkup(
      createElement(BuilderResultPanel, {
        businessSlug: "bedford-bakery-demo",
        state: mapBuilderOrchestrationResult({
          schema_version: 1,
          state: "unsupported",
          reason_code: "operational_plan_unavailable",
          message: BUILDER_UNSUPPORTED_MESSAGES.operational_plan_unavailable,
        }),
      }),
    );
    expect(unsupportedHtml).toContain(
      "This request needs a smaller first step",
    );
    expect(unsupportedHtml).toContain("operational actions");
    expect(unsupportedHtml).toContain('role="status"');
  });

  it("keeps the route, action, navigation, and notice boundaries narrow", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/app/[businessSlug]/builder/page.tsx"),
      "utf8",
    );
    const action = readFileSync(
      join(process.cwd(), "src/app/app/[businessSlug]/builder/actions.ts"),
      "utf8",
    );
    const actionService = readFileSync(
      join(
        process.cwd(),
        "src/app/app/[businessSlug]/builder/action-service.ts",
      ),
      "utf8",
    );
    const changeDetailRoute = readFileSync(
      join(
        process.cwd(),
        "src/app/app/[businessSlug]/changes/[changeSetId]/page.tsx",
      ),
      "utf8",
    );
    const ui = readFileSync(
      join(process.cwd(), "src/components/builder-ui.tsx"),
      "utf8",
    );
    const layout = readFileSync(
      join(process.cwd(), "src/app/app/[businessSlug]/layout.tsx"),
      "utf8",
    );

    expect(route).toContain('dynamic = "force-dynamic"');
    expect(route).toContain('fetchCache = "force-no-store"');
    expect(route).toContain("revalidate = 0");
    expect(route).toContain("maxDuration = 120");
    expect(route).toContain("createServerClient");
    expect(route).toContain("resolveBuilderTenant");
    expect(route).toContain('"manage_configuration"');
    expect(route).toContain("notFound()");
    expect(route).not.toContain("builderOrchestrationService.run");
    expect(changeDetailRoute).toContain(
      "configurationActionNoticeSchema.safeParse",
    );
    expect(changeDetailRoute).toContain(
      "notice={<ConfigurationActionNotice notice={notice} />}",
    );
    expect(changeDetailRoute).not.toContain("notice={noticeValue}");

    expect(action.startsWith('"use server";')).toBe(true);
    expect(action).toContain("createBuilderAction");
    expect(action).not.toContain('formData.get("businessId")');
    expect(action).not.toContain('formData.get("actorId")');
    expect(action).not.toContain('formData.get("proposalId")');
    expect(action).not.toContain("ConfigurationChangeService");
    expect(action).not.toContain(".validate");
    expect(action).not.toContain(".apply");
    expect(action).not.toContain(".publish");

    const source = `${action}\n${actionService}\n${ui}`;
    expect(source).toContain("orchestrationService.run");
    expect(source).toContain("tenant.business.id");
    expect(source).not.toMatch(
      /dangerouslySetInnerHTML|localStorage|sessionStorage|console\.|new OpenAI|\bfetch\s*\(/i,
    );
    expect(source).not.toContain("createAdminClient");
    expect(source).not.toContain("service_role");
    expect(source).not.toContain("draft-compiler");
    expect(source).not.toContain("ConfigurationChangeService");
    expect(source).not.toContain("proposeChangeSet");

    const builderIndex = layout.indexOf(">Builder</Link>");
    const setupIndex = layout.indexOf(">Edit setup</Link>");
    const changesIndex = layout.indexOf(">History</Link>");
    expect(builderIndex).toBeGreaterThan(-1);
    expect(builderIndex).toBeLessThan(setupIndex);
    expect(setupIndex).toBeLessThan(changesIndex);

    expect(
      configurationActionNoticeSchema.safeParse("builder_prepared").success,
    ).toBe(true);
    expect(
      renderToStaticMarkup(
        createElement(ConfigurationActionNotice, {
          notice: "builder_prepared",
        }),
      ),
    ).toContain("Builder prepared this proposal");
    expect(
      configurationActionNoticeSchema.safeParse(
        '<script>alert("arbitrary")</script>',
      ).success,
    ).toBe(false);
    expect(
      renderToStaticMarkup(
        createElement(ConfigurationActionNotice, {
          notice: null,
        }),
      ),
    ).not.toContain("arbitrary");
  });
});
