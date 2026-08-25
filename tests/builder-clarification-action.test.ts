import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createBuilderClarificationContinuationTokenService } from "../src/ai/builder/clarification-continuation-token";
import {
  createBuilderAction,
  initialBuilderUiState,
} from "../src/app/app/[businessSlug]/builder/action-service";

const businessId = "10000000-0000-4000-8000-000000000001";
const actorId = "10000000-0000-4000-8000-000000000002";
const versionId = "10000000-0000-4000-8000-000000000003";
const secret = "builder-clarification-action-test-secret-0123456789";

function clarification(question: string, reference: string) {
  return {
    schema_version: 1 as const,
    state: "needs_clarification" as const,
    base_version_id: versionId,
    head_revision: 4,
    clarification: {
      schema_version: 1 as const,
      state: "needs_clarification" as const,
      understanding: "Lenni understands the requested setup change.",
      known_requirements: [],
      assumptions: [],
      questions: [
        {
          reference,
          question,
          reason: "This needs one clear owner decision.",
          response_style: "free_text" as const,
        },
      ],
      unsupported_requirements: [],
    },
  };
}

function proposed() {
  return {
    schema_version: 1 as const,
    state: "proposed" as const,
    proposal_id: "10000000-0000-4000-8000-000000000004",
    status: "proposed" as const,
    base_version_id: versionId,
    base_head_revision: 4,
    operation_count: 1,
    summary: "A safe change is ready for review.",
  };
}

function dependencies(
  responses: readonly unknown[],
  currentHead: { versionId: string; revision: number } = {
    versionId,
    revision: 4,
  },
) {
  const run = vi.fn();
  for (const response of responses) run.mockResolvedValueOnce(response);
  const supabase = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: {
              business_id: businessId,
              active_version_id: currentHead.versionId,
              head_revision: currentHead.revision,
            },
            error: null,
          })),
        })),
      })),
    })),
  };
  const tokenService = createBuilderClarificationContinuationTokenService({
    secret,
    now: () => 1_000,
  });
  return {
    run,
    action: createBuilderAction({
      createServerClient: async () => supabase as never,
      createClarificationContinuationTokenService: () => tokenService,
      hasCapability: () => true,
      notFound: () => {
        throw new Error("not found");
      },
      orchestrationService: { run } as never,
      resolveTenant: async () =>
        ({
          business: { id: businessId },
          membership: { role: "owner" },
          user: { id: actorId },
        }) as never,
    }),
  };
}

async function begin(
  action: ReturnType<typeof createBuilderAction>,
  request = "Make our opportunity tracking simpler.",
) {
  const formData = new FormData();
  formData.set("ownerRequest", request);
  return action("consultancy", initialBuilderUiState(), formData);
}

describe("Builder clarification action continuation", () => {
  it("sends the original request and a direct answer into the next planning call", async () => {
    const fixture = dependencies([
      clarification("Which statuses should opportunities use?", "question_1"),
      proposed(),
    ]);
    const first = await begin(fixture.action);
    if (first.state !== "needs_clarification" || !first.continuation_token) {
      throw new Error("Expected a clarification continuation.");
    }
    const answer = new FormData();
    answer.set("clarificationContinuationToken", first.continuation_token);
    answer.set("clarificationAnswer_0", "Open, Won and Lost");
    const final = await fixture.action("consultancy", first, answer);

    expect(final).toMatchObject({ state: "proposed" });
    expect(fixture.run).toHaveBeenCalledTimes(2);
    expect(fixture.run.mock.calls[1]?.[1]).toMatchObject({
      businessId,
      ownerRequest: expect.stringContaining(
        "Make our opportunity tracking simpler.",
      ),
    });
    expect(fixture.run.mock.calls[1]?.[1].ownerRequest).toContain(
      "Answer: Open, Won and Lost",
    );
  });

  it("retains the original request and earlier answers through a second round", async () => {
    const fixture = dependencies([
      clarification("Which statuses should opportunities use?", "question_1"),
      clarification(
        "Should Lost opportunities remain visible in the default view?",
        "question_2",
      ),
      proposed(),
    ]);
    const first = await begin(fixture.action);
    if (first.state !== "needs_clarification" || !first.continuation_token) {
      throw new Error("Expected first clarification.");
    }
    const firstAnswer = new FormData();
    firstAnswer.set("clarificationContinuationToken", first.continuation_token);
    firstAnswer.set("clarificationAnswer_0", "Open, Won and Lost");
    const second = await fixture.action("consultancy", first, firstAnswer);
    if (second.state !== "needs_clarification" || !second.continuation_token) {
      throw new Error("Expected second clarification.");
    }
    const secondAnswer = new FormData();
    secondAnswer.set(
      "clarificationContinuationToken",
      second.continuation_token,
    );
    secondAnswer.set("clarificationAnswer_0", "Yes");
    await fixture.action("consultancy", second, secondAnswer);

    const composed = fixture.run.mock.calls[2]?.[1].ownerRequest as string;
    expect(composed).toContain("Make our opportunity tracking simpler.");
    expect(composed).toContain("Answer: Open, Won and Lost");
    expect(composed).toContain("Answer: Yes");
  });

  it("ends stale continuation safely and lets Start over clear it without planning", async () => {
    const stale = dependencies(
      [clarification("Which statuses should opportunities use?", "question_1")],
      { versionId, revision: 5 },
    );
    const initial = await begin(stale.action);
    if (
      initial.state !== "needs_clarification" ||
      !initial.continuation_token
    ) {
      throw new Error("Expected initial clarification.");
    }
    const answer = new FormData();
    answer.set("clarificationContinuationToken", initial.continuation_token);
    answer.set("clarificationAnswer_0", "Open, Won and Lost");
    const staleResult = await stale.action("consultancy", initial, answer);
    expect(staleResult).toMatchObject({ state: "clarification_expired" });
    expect(stale.run).toHaveBeenCalledTimes(1);

    const restart = new FormData();
    restart.set("clarificationStartOver", "true");
    expect(await stale.action("consultancy", initial, restart)).toEqual(
      initialBuilderUiState(),
    );
    expect(stale.run).toHaveBeenCalledTimes(1);
  });
});
