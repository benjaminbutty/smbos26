import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { resolveTenant } from "../../../../../../../auth/authorization";
import { Notice } from "../../../../../../../components/notice";
import { createExperienceService } from "../../../../../../../core/experience/service";
import { createServerClient } from "../../../../../../../db/supabase/server";
import {
  readSearchParam,
  type SearchParams,
} from "../../../../../../../lib/search-params";
import { saveExperienceForm } from "../../../../../../../runtime/forms/actions";
import { FormRenderer } from "../../../../../../../runtime/forms/form-renderer";
import { experiencePathToKey } from "../../../../../../../runtime/routing";

interface EditRecordPageProps {
  params: Promise<{
    businessSlug: string;
    screenSlug: string;
    recordId: string;
  }>;
  searchParams: SearchParams;
}

export default async function EditRecordPage({
  params,
  searchParams,
}: Readonly<EditRecordPageProps>): Promise<ReactNode> {
  const { businessSlug, screenSlug, recordId } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  const experience = createExperienceService(supabase, {
    businessId: tenant.business.id,
  });
  const error = await readSearchParam(searchParams, "error");

  const { source, record, form } = await (async () => {
    try {
      const source = await experience.loadView(experiencePathToKey(screenSlug));
      const record = source.records.find(
        (candidate) => candidate.id === recordId,
      );
      if (!record) {
        notFound();
      }

      const detail = await experience.loadDetailViewForObject(
        source.definition.object_definition_id,
      );
      const sourceEditForm =
        "edit_form_key" in source.config
          ? source.config.edit_form_key
          : undefined;
      const detailEditForm =
        detail && "edit_form_key" in detail.config
          ? detail.config.edit_form_key
          : undefined;
      const editFormKey = detailEditForm ?? sourceEditForm;
      if (!editFormKey) {
        notFound();
      }

      const form = await experience.loadForm(editFormKey);
      return { form, record, source };
    } catch {
      notFound();
    }
  })();

  if (
    form.definition.mode !== "edit" ||
    form.definition.object_definition_id !==
      source.definition.object_definition_id
  ) {
    notFound();
  }

  const detailPath = `/app/${businessSlug}/workspace/${screenSlug}/${recordId}`;
  const editPath = `${detailPath}/edit`;
  const action = saveExperienceForm.bind(
    null,
    businessSlug,
    form.definition.key,
    recordId,
    detailPath,
    editPath,
  );

  return (
    <section className="tenant-content runtime-form-page">
      {error ? <Notice kind="error">{error}</Notice> : null}
      <FormRenderer action={action} bundle={form} record={record} />
      <a className="back-link" href={detailPath}>
        ← Cancel
      </a>
    </section>
  );
}
