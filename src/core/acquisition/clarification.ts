import { z } from "zod";

import { acquisitionCategorySchema, acquisitionRequestSchema } from "./schemas";

export const acquisitionClarificationKeySchema = z.enum([
  "online_booking",
  "booking_services",
  "booking_capacity",
  "public_enquiry",
]);

export type AcquisitionClarificationKey = z.infer<
  typeof acquisitionClarificationKeySchema
>;

const acquisitionClarificationAnswerSchema = z
  .object({
    key: acquisitionClarificationKeySchema,
    answer: z.string().trim().min(1).max(500),
  })
  .strict();

export const acquisitionClarificationStateSchema = z
  .object({
    schema_version: z.literal(1),
    round: z.number().int().min(0).max(2),
    asked_keys: z.array(acquisitionClarificationKeySchema).max(3),
    answers: z.array(acquisitionClarificationAnswerSchema).max(3),
    status: z.enum(["awaiting_answer", "ready"]),
  })
  .strict()
  .superRefine((state, context) => {
    if (new Set(state.asked_keys).size !== state.asked_keys.length) {
      context.addIssue({
        code: "custom",
        message: "A clarification question can only be asked once.",
        path: ["asked_keys"],
      });
    }
    if (
      new Set(state.answers.map(({ key }) => key)).size !== state.answers.length
    ) {
      context.addIssue({
        code: "custom",
        message: "A clarification answer can only be recorded once.",
        path: ["answers"],
      });
    }
    if (state.answers.some(({ key }) => !state.asked_keys.includes(key))) {
      context.addIssue({
        code: "custom",
        message: "Answers must belong to questions already asked.",
        path: ["answers"],
      });
    }
  });

export type AcquisitionClarificationState = z.infer<
  typeof acquisitionClarificationStateSchema
>;

export type AcquisitionClarificationDecisions = {
  onlineBooking: boolean | null;
  usesServices: boolean | null;
  capacityPerSlot: number;
  publicEnquiry: boolean | null;
};

export type AcquisitionClarificationAssessment = {
  state: AcquisitionClarificationState;
  nextQuestion: AcquisitionClarificationKey | null;
  decisions: AcquisitionClarificationDecisions;
};

export const acquisitionClarificationQuestions: Readonly<
  Record<AcquisitionClarificationKey, string>
> = {
  online_booking:
    "Should customers be able to book online, or will Lenni only manage bookings for you internally?",
  booking_services:
    "Do you offer reusable services that customers choose from?",
  booking_capacity:
    "Can you take one booking in each time slot, or more than one?",
  public_enquiry:
    "Should customers be able to send enquiries through a public page, or is this only for your internal work?",
};

const onlineYesPattern =
  /\b(?:online\s+book(?:ing)?|book\s+online|customer(?:s)?\s+(?:can|should)\s+book|booking\s+(?:page|site)|public\s+booking)\b/i;
const onlineNoPattern =
  /\b(?:internal(?:\s+only)?|diary\s+only|no\s+online|not\s+online|whatsapp\s+only|customers?\s+(?:won't|will\s+not|do\s+not)\s+book)\b/i;
const servicesYesPattern =
  /\b(?:services?|treatments?|packages?|menu|grooming\s+packages?)\b/i;
const servicesNoPattern =
  /\b(?:no\s+(?:separate\s+)?services?|service\s+on\s+(?:each|the)\s+booking|don't\s+need\s+services?)\b/i;
const capacityManyPattern =
  /\b(?:more\s+than\s+one|multiple|two|three|several|capacity\s+(?:of|for)\s+\d+)\b/i;
const capacityOnePattern =
  /\b(?:one|single|1)\s+(?:booking\s+)?(?:per\s+)?(?:slot|time)|one\s+at\s+a\s+time\b/i;
const publicEnquiryYesPattern =
  /\b(?:public|online|website|web|customer(?:s)?\s+(?:can|should)\s+(?:send|make)|contact\s+form|enquiry\s+form)\b/i;
const publicEnquiryNoPattern =
  /\b(?:internal\s+only|private\s+only|no\s+(?:public|online)\s+form|don't\s+need\s+(?:a\s+)?(?:public|online)\s+page)\b/i;

function matchingAnswer(
  key: AcquisitionClarificationKey,
  request: string,
  answers: ReadonlyArray<{ key: AcquisitionClarificationKey; answer: string }>,
): string {
  return [
    request,
    ...answers
      .filter((answer) => answer.key === key)
      .map(({ answer }) => answer),
  ].join(" ");
}

function inferBoolean(
  key: AcquisitionClarificationKey,
  request: string,
  answers: ReadonlyArray<{ key: AcquisitionClarificationKey; answer: string }>,
): boolean | null {
  const text = matchingAnswer(key, request, answers);
  if (key === "online_booking") {
    if (onlineYesPattern.test(text)) return true;
    if (onlineNoPattern.test(text)) return false;
  }
  if (key === "booking_services") {
    if (servicesNoPattern.test(text)) return false;
    if (servicesYesPattern.test(text)) return true;
  }
  if (key === "public_enquiry") {
    if (publicEnquiryNoPattern.test(text)) return false;
    if (publicEnquiryYesPattern.test(text)) return true;
  }
  return null;
}

function inferCapacity(
  request: string,
  answers: ReadonlyArray<{ key: AcquisitionClarificationKey; answer: string }>,
): number | null {
  const text = matchingAnswer("booking_capacity", request, answers);
  if (capacityManyPattern.test(text)) {
    const number = text.match(/\b([2-9]|[1-9][0-9]{1,2})\b/);
    return number ? Number(number[1]) : 2;
  }
  if (capacityOnePattern.test(text)) return 1;
  return null;
}

function initialState(): AcquisitionClarificationState {
  return {
    schema_version: 1,
    round: 0,
    asked_keys: [],
    answers: [],
    status: "awaiting_answer",
  };
}

function normaliseState(
  state: AcquisitionClarificationState | null | undefined,
): AcquisitionClarificationState {
  return state
    ? acquisitionClarificationStateSchema.parse(state)
    : initialState();
}

export function assessAcquisitionClarifications(
  categoryInput: unknown,
  requestInput: unknown,
  currentState?: AcquisitionClarificationState | null,
): AcquisitionClarificationAssessment {
  const category = acquisitionCategorySchema.parse(categoryInput);
  const request = acquisitionRequestSchema
    .parse(requestInput)
    .replace(/\s+/g, " ");
  const previous = normaliseState(currentState);
  const answers = previous.answers;
  const asked = new Set(previous.asked_keys);

  let onlineBooking: boolean | null = null;
  let usesServices: boolean | null = null;
  let capacityPerSlot = 1;
  let publicEnquiry: boolean | null = null;
  let nextQuestion: AcquisitionClarificationKey | null = null;

  if (category === "appointments") {
    onlineBooking = inferBoolean("online_booking", request, answers);
    if (onlineBooking === null && !asked.has("online_booking")) {
      nextQuestion = "online_booking";
    } else if (onlineBooking === null) {
      onlineBooking = false;
    }

    if (nextQuestion === null && onlineBooking === true) {
      usesServices = inferBoolean("booking_services", request, answers);
      if (usesServices === null && !asked.has("booking_services")) {
        nextQuestion = "booking_services";
      } else if (usesServices === null) {
        usesServices = false;
      }

      capacityPerSlot = inferCapacity(request, answers) ?? 1;
      if (
        nextQuestion === null &&
        inferCapacity(request, answers) === null &&
        !asked.has("booking_capacity")
      ) {
        nextQuestion = "booking_capacity";
      }
    }
  } else if (category === "enquiries") {
    publicEnquiry = inferBoolean("public_enquiry", request, answers);
    if (publicEnquiry === null && !asked.has("public_enquiry")) {
      nextQuestion = "public_enquiry";
    } else if (publicEnquiry === null) {
      publicEnquiry = false;
    }
  }

  const exhausted = previous.asked_keys.length >= 3;
  if (nextQuestion && exhausted) nextQuestion = null;
  const status = nextQuestion ? "awaiting_answer" : "ready";
  const nextState = nextQuestion
    ? stateWithQuestion(
        acquisitionClarificationStateSchema.parse({
          ...previous,
          round: Math.min(2, previous.answers.length),
          status,
        }),
        nextQuestion,
      )
    : acquisitionClarificationStateSchema.parse({
        ...previous,
        round: Math.min(2, previous.answers.length),
        status,
      });

  return {
    state: nextState,
    nextQuestion,
    decisions: {
      onlineBooking,
      usesServices,
      capacityPerSlot,
      publicEnquiry,
    },
  };
}

export function addClarificationAnswer(
  stateInput: AcquisitionClarificationState,
  keyInput: unknown,
  answerInput: unknown,
): AcquisitionClarificationState {
  const state = acquisitionClarificationStateSchema.parse(stateInput);
  const key = acquisitionClarificationKeySchema.parse(keyInput);
  const answer = z.string().trim().min(1).max(500).parse(answerInput);
  if (state.status !== "awaiting_answer" || !state.asked_keys.includes(key)) {
    throw new Error("That Lenni question is no longer active.");
  }
  if (state.answers.some((entry) => entry.key === key)) {
    throw new Error("That Lenni question has already been answered.");
  }
  return acquisitionClarificationStateSchema.parse({
    ...state,
    round: Math.min(2, state.answers.length + 1),
    answers: [...state.answers, { key, answer }],
  });
}

export function stateWithQuestion(
  stateInput: AcquisitionClarificationState,
  question: AcquisitionClarificationKey,
): AcquisitionClarificationState {
  const state = acquisitionClarificationStateSchema.parse(stateInput);
  if (state.asked_keys.includes(question)) return state;
  if (state.asked_keys.length >= 3) {
    throw new Error("The bounded clarification limit has been reached.");
  }
  return acquisitionClarificationStateSchema.parse({
    ...state,
    asked_keys: [...state.asked_keys, question],
    status: "awaiting_answer",
  });
}

export function buildEnrichedAcquisitionRequest(
  requestInput: unknown,
  decisions: AcquisitionClarificationDecisions,
): string {
  const request = acquisitionRequestSchema
    .parse(requestInput)
    .replace(/\s+/g, " ");
  const decisionsText = [
    decisions.onlineBooking === null
      ? null
      : `customer online booking: ${decisions.onlineBooking ? "yes" : "no"}`,
    decisions.onlineBooking !== true || decisions.usesServices === null
      ? null
      : `reusable customer services: ${decisions.usesServices ? "yes" : "no"}`,
    decisions.onlineBooking !== true
      ? null
      : `capacity per booking slot: ${decisions.capacityPerSlot}`,
    decisions.publicEnquiry === null
      ? null
      : `public enquiry page: ${decisions.publicEnquiry ? "yes" : "no"}`,
  ].filter((value): value is string => value !== null);
  const suffix = `\n\nStructured owner decisions (use these when shaping the starting system): ${decisionsText.join("; ")}.`;
  const available = Math.max(12, 4_000 - suffix.length);
  return `${request.slice(0, available)}${suffix}`;
}

export function questionText(key: AcquisitionClarificationKey): string {
  return acquisitionClarificationQuestions[key];
}
