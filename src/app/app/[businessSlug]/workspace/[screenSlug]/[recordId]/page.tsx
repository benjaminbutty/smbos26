import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { resolveTenant } from "../../../../../../auth/authorization";
import { Notice } from "../../../../../../components/notice";
import {
  createExperienceService,
  type ExperienceViewBundle,
} from "../../../../../../core/experience/service";
import type { DetailViewConfig } from "../../../../../../core/experience/schemas";
import { createServerClient } from "../../../../../../db/supabase/server";
import {
  readSearchParam,
  type SearchParams,
} from "../../../../../../lib/search-params";
import { experiencePathToKey } from "../../../../../../runtime/routing";
import {
  ViewRenderer,
  viewFieldKeys,
} from "../../../../../../runtime/views/view-renderer";

interface RecordDetailPageProps {
  params: Promise<{
    businessSlug: string;
    screenSlug: string;
    recordId: string;
  }>;
  searchParams: SearchParams;
}

function fallbackDetailBundle(
  source: ExperienceViewBundle,
): ExperienceViewBundle {
  const fields = viewFieldKeys(source);
  const sourceConfig = source.config;
  const titleField =
    "title_field" in sourceConfig
      ? sourceConfig.title_field
      : "primary_field" in sourceConfig
        ? sourceConfig.primary_field
        : fields[0];
  const editFormKey =
    "edit_form_key" in sourceConfig ? sourceConfig.edit_form_key : undefined;
  const config: DetailViewConfig = {
    fields,
    include_archived: sourceConfig.include_archived,
    ...(titleField ? { title_field: titleField } : {}),
    ...(editFormKey ? { edit_form_key: editFormKey } : {}),
  };

  return {
    ...source,
    definition: {
      ...source.definition,
      view_type: "detail",
    },
    config,
  };
}

export default async function RecordDetailPage({
  params,
  searchParams,
}: Readonly<RecordDetailPageProps>): Promise<ReactNode> {
  const { businessSlug, screenSlug, recordId } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  const experience = createExperienceService(supabase, {
    businessId: tenant.business.id,
  });
  const [error, message] = await Promise.all([
    readSearchParam(searchParams, "error"),
    readSearchParam(searchParams, "message"),
  ]);

  const { source, detail, record } = await (async () => {
    try {
      const source = await experience.loadView(experiencePathToKey(screenSlug));
      const sourceRecord = source.records.find(
        (candidate) => candidate.id === recordId,
      );
      if (!sourceRecord) {
        notFound();
      }

      const configuredDetail = await experience.loadDetailViewForObject(
        source.definition.object_definition_id,
      );
      const detail = configuredDetail ?? fallbackDetailBundle(source);
      const record = configuredDetail
        ? configuredDetail.records.find(
            (candidate) => candidate.id === recordId,
          )
        : sourceRecord;
      if (!record) {
        notFound();
      }

      return { detail, record, source };
    } catch {
      notFound();
    }
  })();

  return (
    <section className="tenant-content">
      {error ? <Notice kind="error">{error}</Notice> : null}
      {message ? <Notice kind="message">{message}</Notice> : null}
      <ViewRenderer
        bundle={detail}
        businessSlug={businessSlug}
        navigationViewKey={source.definition.key}
        record={record}
      />
    </section>
  );
}
