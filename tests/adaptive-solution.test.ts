import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deriveAdaptiveSolutionChoice } from "../src/ai/builder/adaptive-solution";
import {
  BuilderAdaptiveSolutionChoiceTokenError,
  createBuilderAdaptiveSolutionChoiceTokenService,
} from "../src/ai/builder/adaptive-solution-choice-token";
import { builderAdaptiveSolutionChoiceResultSchema } from "../src/ai/builder/contracts";
import {
  projectAiBusinessModelContext,
  type AiBusinessContextSource,
} from "../src/ai/context/projector";
import type { AiBusinessModelContextV1 } from "../src/ai/context/schemas";

const ids = {
  business: "30000000-0000-4000-8000-000000000001",
  actor: "30000000-0000-4000-8000-000000000002",
  otherBusiness: "30000000-0000-4000-8000-000000000003",
  otherActor: "30000000-0000-4000-8000-000000000004",
  version: "30000000-0000-4000-8000-000000000005",
};

function context(
  primary: { key: string; singular: string; plural: string },
  related: { key: string; singular: string; plural: string },
): AiBusinessModelContextV1 {
  const source: AiBusinessContextSource = {
    business: {
      name: "Example Business",
      businessType: "service",
      timezone: "Europe/London",
    },
    access: { role: "owner", capabilities: ["manage_configuration"] },
    activeConfiguration: {
      versionNumber: 1,
      revision: 1,
      snapshot: {
        schema_version: 1,
        object_definitions: [],
        field_definitions: [],
        relationship_definitions: [],
        views: [],
        forms: [],
        pages: [],
        preorder_experiences: [],
        preorder_experience_locations: [],
      },
    },
    locations: [],
  };
  const base = projectAiBusinessModelContext(source).modelContext;
  return {
    ...base,
    objects: [
      {
        key: primary.key,
        singular_label: primary.singular,
        plural_label: primary.plural,
        description: `${primary.plural} the business works from.`,
        kind: "custom",
        semantic_type: null,
        icon: null,
        is_active: true,
        fields: [],
      },
      {
        key: related.key,
        singular_label: related.singular,
        plural_label: related.plural,
        description: `${related.plural} connected to the primary work.`,
        kind: "custom",
        semantic_type: null,
        icon: null,
        is_active: true,
        fields: [],
      },
    ],
    relationships: [
      {
        key: `${primary.key}_has_${related.key}`,
        source_object_key: primary.key,
        target_object_key: related.key,
        source_label: `has ${related.plural}`,
        target_label: `belongs to ${primary.singular}`,
        cardinality: "one_to_many",
        is_required: false,
        is_active: true,
      },
    ],
    views: [
      {
        key: `${primary.key}_table`,
        name: primary.plural,
        view_type: "table",
        object_key: primary.key,
        audience: "internal",
        is_active: true,
        configuration: { fields: ["name"], include_archived: false },
      },
    ],
  };
}

function choiceFor(
  ownerRequest: string,
  primary = { key: "company", singular: "Company", plural: "Companies" },
  related = {
    key: "opportunity",
    singular: "Opportunity",
    plural: "Opportunities",
  },
) {
  return deriveAdaptiveSolutionChoice({
    ownerRequest,
    context: context(primary, related),
    baseVersionId: ids.version,
    headRevision: 4,
  });
}

describe("adaptive solution choice", () => {
  it("grounds the consultancy request in its real Connection and supported consequences", () => {
    const choice = choiceFor(
      "I don’t need a separate table for opportunities, I want to be able to add them in a single table with companies rather than manage two tables",
    );
    expect(choice).toMatchObject({
      state: "adaptive_solution_choice",
      understanding: expect.stringContaining("Companies"),
      current_approach: expect.stringContaining("Opportunities"),
      base_version_id: ids.version,
      head_revision: 4,
    });
    expect(choice?.options).toHaveLength(2);
    expect(choice?.options.map(({ consequence }) => consequence.kind)).toEqual([
      "use_current_related_workflow",
      "prepare_primary_workflow_adaptation",
    ]);
    expect(choice?.options[1]?.tradeoffs.join(" ")).toContain(
      "will not combine or rewrite",
    );
    expect(builderAdaptiveSolutionChoiceResultSchema.parse(choice)).toEqual(
      choice,
    );
  });

  it("uses the same reasoning for a Job and Task workspace without CRM terms", () => {
    const choice = choiceFor(
      "I don’t want Tasks in a separate Table. I want to manage them from each Job instead.",
      { key: "job", singular: "Job", plural: "Jobs" },
      { key: "task", singular: "Task", plural: "Tasks" },
    );
    expect(choice?.understanding).toContain("Jobs");
    expect(choice?.current_approach).toContain("Tasks");
    expect(JSON.stringify(choice)).not.toMatch(/compan|opportunit/i);
  });

  it("does not turn an unrelated or ungrounded request into advice", () => {
    expect(choiceFor("Add a weekly invoice reminder.")).toBeNull();
    expect(
      choiceFor("I want to manage follow-ups from each Company instead."),
    ).toBeNull();
  });

  it("offers only the verified current workflow when a configuration adaptation is unavailable", () => {
    const workspace = context(
      { key: "customer", singular: "Customer", plural: "Customers" },
      { key: "pet", singular: "Pet", plural: "Pets" },
    );
    workspace.platform_capabilities.configuration_operation_names =
      workspace.platform_capabilities.configuration_operation_names.filter(
        (operation) => operation !== "set_view",
      );
    const choice = deriveAdaptiveSolutionChoice({
      ownerRequest:
        "I don't want Pets in a separate table. I want to manage them from each Customer instead.",
      context: workspace,
      baseVersionId: ids.version,
      headRevision: 4,
    });
    expect(choice?.options).toHaveLength(1);
    expect(choice?.options[0]?.id).toBe("work_from_primary");
  });

  it("rejects an option whose displayed id does not match its trusted consequence", () => {
    const choice = choiceFor(
      "I want Opportunities in a single table with Companies instead of a separate table.",
    );
    if (!choice) throw new Error("Expected an adaptive choice.");
    expect(
      builderAdaptiveSolutionChoiceResultSchema.safeParse({
        ...choice,
        options: [
          {
            ...choice.options[0],
            consequence: choice.options[1]?.consequence,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("uses a signed, actor- and Business-bound short choice continuation", () => {
    const choice = choiceFor(
      "I want Opportunities in a single table with Companies instead of a separate table.",
    );
    if (!choice) throw new Error("Expected an adaptive choice.");
    const tokenService = createBuilderAdaptiveSolutionChoiceTokenService({
      secret: "adaptive-solution-choice-test-secret-0123456789",
      now: () => 1_000,
    });
    const token = tokenService.sign({
      businessId: ids.business,
      actorId: ids.actor,
      originalOwnerRequest: "Make our opportunity workflow simpler.",
      choice,
    });
    expect(
      tokenService.verify(token, {
        businessId: ids.business,
        actorId: ids.actor,
      }).choice.options,
    ).toHaveLength(2);
    expect(() =>
      tokenService.verify(token, {
        businessId: ids.otherBusiness,
        actorId: ids.actor,
      }),
    ).toThrow(BuilderAdaptiveSolutionChoiceTokenError);
    expect(() =>
      tokenService.verify(token, {
        businessId: ids.business,
        actorId: ids.otherActor,
      }),
    ).toThrow(BuilderAdaptiveSolutionChoiceTokenError);
  });
});
