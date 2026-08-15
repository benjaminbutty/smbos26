import { describe, expect, it } from "vitest";

import {
  addClarificationAnswer,
  assessAcquisitionClarifications,
  buildEnrichedAcquisitionRequest,
} from "../src/core/acquisition/clarification";
import { enhanceAcquisitionPayload } from "../src/core/acquisition/capabilities";
import { composeStarterComposition } from "../src/core/acquisition/composer";
import { bookingConfigSchema } from "../src/core/booking/schemas";

describe("Journey 1 bounded acquisition clarification", () => {
  it("asks the material online booking question for a thin appointment prompt", () => {
    const assessment = assessAcquisitionClarifications(
      "appointments",
      "I run a mobile dog grooming business and organise customers and bookings through WhatsApp.",
    );

    expect(assessment.nextQuestion).toBe("online_booking");
    expect(assessment.state.asked_keys).toEqual(["online_booking"]);
    expect(assessment.decisions.onlineBooking).toBeNull();
  });

  it("completes online booking discovery in no more than three questions", () => {
    let assessment = assessAcquisitionClarifications(
      "appointments",
      "I run a mobile dog grooming business.",
    );
    let state = assessment.state;

    state = addClarificationAnswer(
      state,
      assessment.nextQuestion,
      "Yes, customers should book online.",
    );
    assessment = assessAcquisitionClarifications(
      "appointments",
      "I run a mobile dog grooming business.",
      state,
    );
    expect(assessment.nextQuestion).toBe("booking_services");
    state = addClarificationAnswer(
      assessment.state,
      assessment.nextQuestion,
      "Yes, customers choose reusable grooming services.",
    );
    assessment = assessAcquisitionClarifications(
      "appointments",
      "I run a mobile dog grooming business.",
      state,
    );
    expect(assessment.nextQuestion).toBe("booking_capacity");
    state = addClarificationAnswer(
      assessment.state,
      assessment.nextQuestion,
      "One booking per slot.",
    );
    assessment = assessAcquisitionClarifications(
      "appointments",
      "I run a mobile dog grooming business.",
      state,
    );

    expect(assessment.nextQuestion).toBeNull();
    expect(assessment.state.answers).toHaveLength(3);
    expect(assessment.decisions).toMatchObject({
      onlineBooking: true,
      usesServices: true,
      capacityPerSlot: 1,
    });
  });

  it("does not create an online Site for internal-only bookings", () => {
    const initial = assessAcquisitionClarifications(
      "appointments",
      "I run a dog grooming business and keep an internal diary.",
    );

    expect(initial.nextQuestion).toBeNull();
    expect(initial.decisions.onlineBooking).toBe(false);
  });

  it("qualifies a public enquiry Page separately from appointment booking", () => {
    const initial = assessAcquisitionClarifications(
      "enquiries",
      "I need to organise enquiries for my service business.",
    );
    const answered = addClarificationAnswer(
      initial.state,
      initial.nextQuestion,
      "Yes, customers should send enquiries through a public page.",
    );
    const assessment = assessAcquisitionClarifications(
      "enquiries",
      "I need to organise enquiries for my service business.",
      answered,
    );

    expect(assessment.nextQuestion).toBeNull();
    expect(assessment.decisions.publicEnquiry).toBe(true);
  });

  it("leaves a milk round conservative and free of irrelevant Site or Location decisions", () => {
    const assessment = assessAcquisitionClarifications(
      "delivery",
      "I deliver milk locally and confirm each customer's weekly order.",
    );

    expect(assessment.nextQuestion).toBeNull();
    expect(assessment.decisions.onlineBooking).toBeNull();
    expect(assessment.decisions.publicEnquiry).toBeNull();
    expect(
      buildEnrichedAcquisitionRequest(
        "I deliver milk locally.",
        assessment.decisions,
      ),
    ).toContain("I deliver milk locally.");
  });
});

describe("Journey 1 deterministic public capability composition", () => {
  it("adds a draft Booking Site and connected dog-grooming example shape", () => {
    const payload = enhanceAcquisitionPayload(
      composeStarterComposition(
        "appointments",
        "I run a mobile dog grooming business.",
      ),
      {
        onlineBooking: true,
        usesServices: true,
        capacityPerSlot: 1,
        publicEnquiry: null,
      },
      "I run a mobile dog grooming business.",
    );
    const objects = payload.operations
      .filter((operation) => operation.op === "set_object")
      .map((operation) => operation.key);
    const bookingPage = payload.operations.find(
      (operation) =>
        operation.op === "set_page" &&
        operation.audience === "public" &&
        operation.layout_json.blocks.some((block) => block.type === "booking"),
    );

    expect(objects).toEqual(["customer", "appointment", "service", "pet"]);
    expect(
      payload.operations.some(
        (operation) =>
          operation.op === "set_field" &&
          operation.object_key === "appointment" &&
          operation.field_type === "datetime",
      ),
    ).toBe(true);
    expect(bookingPage).toMatchObject({ audience: "public", status: "draft" });
    if (!bookingPage || bookingPage.op !== "set_page") return;
    const block = bookingPage.layout_json.blocks.find(
      (candidate) => candidate.type === "booking",
    );
    expect(block?.type).toBe("booking");
    if (block?.type === "booking") {
      expect(
        bookingConfigSchema.parse(block.config).schedule.capacity_per_slot,
      ).toBe(1);
      expect(block.config.subject_object_key).toBe("pet");
    }
    expect(payload.proposal.not_included).not.toContain("Public booking");
  });

  it("adds a narrow draft public Form without adding arbitrary relationships", () => {
    const payload = enhanceAcquisitionPayload(
      composeStarterComposition(
        "enquiries",
        "I need to organise customer enquiries.",
      ),
      {
        onlineBooking: null,
        usesServices: null,
        capacityPerSlot: 1,
        publicEnquiry: true,
      },
      "I need to organise customer enquiries.",
    );
    const publicForm = payload.operations.find(
      (operation) =>
        operation.op === "set_form" && operation.audience === "public",
    );
    const publicPage = payload.operations.find(
      (operation) =>
        operation.op === "set_page" &&
        operation.audience === "public" &&
        operation.layout_json.blocks.some(
          (block) => block.type === "public_form",
        ),
    );

    expect(publicForm).toBeDefined();
    expect(publicPage).toMatchObject({ audience: "public", status: "draft" });
    expect(
      payload.operations.filter(
        (operation) => operation.op === "set_relationship",
      ),
    ).toHaveLength(2);
    expect(payload.proposal.not_included).not.toContain("Public forms");
  });

  it("removes a separate service concept when the owner says it is unnecessary", () => {
    const payload = enhanceAcquisitionPayload(
      composeStarterComposition("appointments", "I manage appointments."),
      {
        onlineBooking: false,
        usesServices: false,
        capacityPerSlot: 1,
        publicEnquiry: null,
      },
      "I manage appointments.",
    );
    expect(
      payload.operations.some(
        (operation) =>
          (operation.op === "set_object" && operation.key === "service") ||
          (operation.op === "set_relationship" &&
            (operation.source_object_key === "service" ||
              operation.target_object_key === "service")),
      ),
    ).toBe(false);
  });
});
