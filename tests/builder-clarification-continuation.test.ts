import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BUILDER_CLARIFICATION_MAX_ROUNDS,
  composeClarificationOwnerRequest,
  createBuilderClarificationContinuationTokenService,
  parseClarificationAnswers,
} from "../src/ai/builder/clarification-continuation-token";

const businessId = "10000000-0000-4000-8000-000000000001";
const actorId = "10000000-0000-4000-8000-000000000002";
const versionId = "10000000-0000-4000-8000-000000000003";
const secret = "clarification-continuation-test-secret-0123456789";

const questions = [
  {
    reference: "question_1",
    question: "Which statuses should opportunities use?",
    reason: "Lenni needs the agreed workflow labels.",
    response_style: "multiple_choice" as const,
    options: ["Open", "Won", "Lost"],
  },
  {
    reference: "question_2",
    question: "Should Lost opportunities remain visible by default?",
    reason: "Lenni needs to set up the default view safely.",
    response_style: "single_choice" as const,
    options: ["Yes", "No"],
  },
  {
    reference: "question_3",
    question: "What should the team see when an opportunity is lost?",
    reason: "This records the owner’s preferred context.",
    response_style: "free_text" as const,
  },
];

function continuationToken(now = 1_000) {
  const service = createBuilderClarificationContinuationTokenService({
    secret,
    now: () => now,
  });
  return {
    service,
    token: service.sign({
      businessId,
      actorId,
      baseVersionId: versionId,
      headRevision: 4,
      originalOwnerRequest: "Make our opportunity tracking simpler.",
      questions,
      answers: [],
      round: 1,
    }),
  };
}

describe("Builder clarification continuation", () => {
  it("binds the original request, questions, actor, Business and currentness", () => {
    const { service, token } = continuationToken();
    expect(service.verify(token, { businessId, actorId })).toMatchObject({
      original_owner_request: "Make our opportunity tracking simpler.",
      base_version_id: versionId,
      head_revision: 4,
      round: 1,
      questions,
    });
    expect(() =>
      service.verify(token, { businessId, actorId: businessId }),
    ).toThrow(/clarification|session/i);
  });

  it("accepts direct answer controls and composes original intent with every prior answer", () => {
    const { service, token } = continuationToken();
    const payload = service.verify(token, { businessId, actorId });
    const firstRound = new FormData();
    firstRound.append("clarificationAnswer_0", "Open");
    firstRound.append("clarificationAnswer_0", "Won");
    firstRound.append("clarificationAnswer_0", "Lost");
    firstRound.set("clarificationAnswer_1", "Yes");
    firstRound.set("clarificationAnswer_2", "Show the reason beside it.");
    const answers = parseClarificationAnswers(payload, firstRound);

    expect(answers).toHaveLength(3);
    expect(
      composeClarificationOwnerRequest(payload.original_owner_request, answers),
    ).toContain(
      "Original owner request:\nMake our opportunity tracking simpler.",
    );
    expect(
      composeClarificationOwnerRequest(payload.original_owner_request, answers),
    ).toContain("Answer: Open, Won, Lost");

    const nextToken = service.sign({
      businessId,
      actorId,
      baseVersionId: versionId,
      headRevision: 4,
      originalOwnerRequest: payload.original_owner_request,
      questions: [questions[1]!],
      answers,
      round: 2,
    });
    const nextPayload = service.verify(nextToken, { businessId, actorId });
    expect(nextPayload.answers).toEqual(answers);
    expect(nextPayload.round).toBe(2);
  });

  it("rejects unavailable options, tampering, expiry and excessive rounds", () => {
    const { service, token } = continuationToken();
    const payload = service.verify(token, { businessId, actorId });
    const invalidAnswer = new FormData();
    invalidAnswer.append("clarificationAnswer_0", "Deleted option");
    invalidAnswer.set("clarificationAnswer_1", "Yes");
    invalidAnswer.set("clarificationAnswer_2", "A note");
    expect(() => parseClarificationAnswers(payload, invalidAnswer)).toThrow(
      /available|invalid/i,
    );
    expect(() => service.verify(`${token}x`, { businessId, actorId })).toThrow(
      /clarification|session/i,
    );

    const expired = createBuilderClarificationContinuationTokenService({
      secret,
      now: () => 1_901,
    });
    expect(() => expired.verify(token, { businessId, actorId })).toThrow(
      /clarification|session/i,
    );
    expect(() =>
      service.sign({
        businessId,
        actorId,
        baseVersionId: versionId,
        headRevision: 4,
        originalOwnerRequest: "A request",
        questions: [questions[0]!],
        answers: [],
        round: BUILDER_CLARIFICATION_MAX_ROUNDS + 1,
      }),
    ).toThrow(/clarification|session/i);
    expect(() =>
      composeClarificationOwnerRequest("\u0800".repeat(7_900), []),
    ).toThrow(/clarification|session/i);
  });
});
