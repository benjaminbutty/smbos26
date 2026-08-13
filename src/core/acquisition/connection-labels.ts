export type AcquisitionRelationshipCardinality =
  "one_to_one" | "one_to_many" | "many_to_many";

export interface AcquisitionConceptNames {
  singular: string;
  plural: string;
}

export interface AcquisitionConnectionLabels {
  source: string;
  target: string;
}

export function deriveAcquisitionConnectionLabels({
  source,
  target,
  cardinality,
}: {
  source: AcquisitionConceptNames;
  target: AcquisitionConceptNames;
  cardinality: AcquisitionRelationshipCardinality;
}): AcquisitionConnectionLabels {
  switch (cardinality) {
    case "one_to_one":
      return { source: target.singular, target: source.singular };
    case "one_to_many":
      return { source: target.plural, target: source.singular };
    case "many_to_many":
      return { source: target.plural, target: source.plural };
  }
}
