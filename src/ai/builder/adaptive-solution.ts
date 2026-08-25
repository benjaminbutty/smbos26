import type { AiBusinessModelContextV1 } from "../context/schemas";
import {
  builderAdaptiveOptionSchema,
  builderAdaptiveSolutionChoiceResultSchema,
  type BuilderOrchestrationResult,
} from "./contracts";
import type { z } from "zod";

type AdaptiveOption = z.infer<typeof builderAdaptiveOptionSchema>;

function normalise(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en");
}

function indefiniteArticle(label: string): "a" | "an" {
  return /^[aeiou]/iu.test(label.trim()) ? "an" : "a";
}

function mentionsObject(
  request: string,
  object: { singular_label: string; plural_label: string },
): boolean {
  const normalisedRequest = normalise(request);
  return (
    normalisedRequest.includes(normalise(object.singular_label)) ||
    normalisedRequest.includes(normalise(object.plural_label))
  );
}

function asksForOneOperatingSurface(request: string): boolean {
  const value = normalise(request);
  return (
    /\b(?:one|single)\s+(?:table|place|workspace)\b/.test(value) ||
    /\bseparate\s+table(?:s)?\b/.test(value) ||
    /\bmanage\b[\s\S]{0,100}\b(?:from|inside|within)\b/.test(value)
  );
}

function asksToWorkFrom(request: string, label: string): boolean {
  const escaped = normalise(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\b(?:from|inside|within|with|in)\\s+(?:each\\s+)?${escaped}\\b`,
    "u",
  ).test(normalise(request));
}

/**
 * A deliberately small, server-owned recognition of a common owner outcome:
 * work from the parent side of a real one-to-many Connection.  It uses only
 * configured metadata; it neither reads Records nor infers an executable
 * merge, archive, navigation route, or data migration.
 */
export function deriveAdaptiveSolutionChoice(input: {
  ownerRequest: string;
  context: AiBusinessModelContextV1;
  baseVersionId: string;
  headRevision: number;
}): Extract<
  BuilderOrchestrationResult,
  { state: "adaptive_solution_choice" }
> | null {
  const { context, ownerRequest } = input;
  if (ownerRequest.includes("[Lenni adaptation selection]")) return null;
  if (!asksForOneOperatingSurface(ownerRequest)) return null;

  const activeObjects = new Map(
    context.objects
      .filter((object) => object.is_active)
      .map((object) => [object.key, object]),
  );
  const candidate = context.relationships.find((relationship) => {
    if (relationship.cardinality !== "one_to_many" || !relationship.is_active) {
      return false;
    }
    const primary = activeObjects.get(relationship.source_object_key);
    const related = activeObjects.get(relationship.target_object_key);
    return Boolean(
      primary &&
      related &&
      mentionsObject(ownerRequest, primary) &&
      mentionsObject(ownerRequest, related) &&
      (asksToWorkFrom(ownerRequest, primary.singular_label) ||
        asksToWorkFrom(ownerRequest, primary.plural_label)),
    );
  });
  if (!candidate) return null;

  const primary = activeObjects.get(candidate.source_object_key);
  const related = activeObjects.get(candidate.target_object_key);
  if (!primary || !related) return null;
  const primaryView = context.views.find(
    (view) =>
      view.is_active &&
      view.object_key === primary.key &&
      view.audience === "internal" &&
      view.view_type === "table",
  );
  if (!primaryView) return null;
  const canAdapt =
    context.platform_capabilities.configuration_operation_names.includes(
      "set_field",
    ) &&
    context.platform_capabilities.configuration_operation_names.includes(
      "set_view",
    );

  const options: AdaptiveOption[] = [
    {
      id: "work_from_primary" as const,
      label: `Work from ${primary.plural_label}`,
      summary: `Use ${primary.plural_label} as the main place you work, and add ${related.plural_label} directly while you are with ${indefiniteArticle(primary.singular_label)} ${primary.singular_label}.`,
      benefits: [
        `You avoid switching Tables just to add ${indefiniteArticle(related.singular_label)} ${related.singular_label}.`,
        `One ${primary.singular_label} can still keep several separate ${related.plural_label}.`,
      ],
      tradeoffs: [
        `${related.plural_label} remain available as their own work list when you need to review them together.`,
      ],
      consequence: {
        kind: "use_current_related_workflow" as const,
        primary_object_key: primary.key,
        primary_object_label: primary.plural_label,
        primary_singular_label: primary.singular_label,
        related_object_key: related.key,
        related_object_label: related.plural_label,
        relationship_key: candidate.key,
        primary_view_key: primaryView.key,
      },
    },
  ];
  if (canAdapt) {
    options.push({
      id: "simplify_around_primary" as const,
      label: `Simplify around ${primary.plural_label}`,
      summary: `Prepare a ${primary.singular_label}-centred setup for the current ${related.singular_label} details you want to manage, with a focused ${primary.plural_label} view.`,
      benefits: [
        `Future work can be managed more directly from ${primary.plural_label}.`,
        `The new view can make the ${primary.singular_label}-centred workflow the easier place to start.`,
      ],
      tradeoffs: [
        `This is best when one current ${related.singular_label} per ${primary.singular_label} is usually enough.`,
        `Existing ${related.plural_label} and their connections stay intact; Lenni will not combine or rewrite them.`,
      ],
      consequence: {
        kind: "prepare_primary_workflow_adaptation" as const,
        primary_object_key: primary.key,
        primary_object_label: primary.plural_label,
        primary_singular_label: primary.singular_label,
        related_object_key: related.key,
        related_object_label: related.plural_label,
        relationship_key: candidate.key,
      },
    });
  }

  return builderAdaptiveSolutionChoiceResultSchema.parse({
    schema_version: 1,
    state: "adaptive_solution_choice",
    understanding: `You want ${primary.plural_label} to be the main place you manage ${related.plural_label}, without having to work across separate Tables.`,
    current_approach: `Right now ${primary.plural_label} and ${related.plural_label} are kept separate. This lets one ${primary.singular_label} have several ${related.plural_label} over time, while still giving you a complete ${related.plural_label} list when that is useful. You can already add ${indefiniteArticle(related.singular_label)} ${related.singular_label} directly while working from ${indefiniteArticle(primary.singular_label)} ${primary.singular_label}.`,
    options,
    recommendation: `If one ${primary.singular_label} often has several separate ${related.plural_label}, working from ${primary.plural_label} keeps that flexibility. If there is normally one current ${related.singular_label} and simplicity matters more, the ${primary.singular_label}-centred setup may suit you better.`,
    question: "Which would suit you better?",
    base_version_id: input.baseVersionId,
    head_revision: input.headRevision,
  });
}
