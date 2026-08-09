import "server-only";

import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../definition-source";
import { ConfigurationChangeService } from "../service";
import {
  composeManualList,
  ManualListError,
  type ComposedManualList,
} from "./composer";
import {
  manualListPreparationRequestSchema,
  type ManualListPreparationRequest,
} from "./schemas";

export { ManualListError } from "./composer";

type ConfigurationChangeSet = Awaited<
  ReturnType<ConfigurationChangeService["proposeChangeSet"]>
>;

export interface ActiveManualListSnapshot {
  baseVersionId: string;
  headRevision: number;
  snapshot: ConfigurationSnapshotV1;
}

export async function loadActiveManualListSnapshot(
  configuration: ConfigurationChangeService,
): Promise<ActiveManualListSnapshot> {
  const head = await configuration.getActiveHead();
  const version = await configuration.getVersion(head.active_version_id);
  let snapshot: ConfigurationSnapshotV1;
  try {
    snapshot = configurationSnapshotV1Schema.parse(version.snapshot_json);
  } catch (error) {
    throw new ManualListError("manual_list_snapshot_invalid", error);
  }
  return {
    baseVersionId: version.id,
    headRevision: head.head_revision,
    snapshot,
  };
}

export async function prepareManualListProposal(
  configuration: ConfigurationChangeService,
  input: ManualListPreparationRequest,
): Promise<ConfigurationChangeSet> {
  let parsed: ManualListPreparationRequest;
  try {
    parsed = manualListPreparationRequestSchema.parse(input);
  } catch (error) {
    throw new ManualListError("manual_list_input_invalid", error);
  }

  const active = await loadActiveManualListSnapshot(configuration);
  if (
    active.baseVersionId !== parsed.expectedBaseVersionId ||
    active.headRevision !== parsed.expectedHeadRevision
  ) {
    throw new ManualListError("manual_list_stale");
  }

  const intent = {
    singularItemLabel: parsed.singularItemLabel,
    pluralListLabel: parsed.pluralListLabel,
    mainNameLabel: parsed.mainNameLabel,
    information: parsed.information,
  };
  const composed: ComposedManualList = composeManualList(
    active.snapshot,
    intent,
  );
  return configuration.proposeChangeSet({
    expectedBaseVersionId: active.baseVersionId,
    expectedHeadRevision: active.headRevision,
    title: composed.title,
    description: composed.description,
    operations: composed.operations,
  });
}
