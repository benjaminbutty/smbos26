import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { resolveTenant } from "../../../../../../auth/authorization";
import { Notice } from "../../../../../../components/notice";
import { createExperienceService } from "../../../../../../core/experience/service";
import { createServerClient } from "../../../../../../db/supabase/server";
import {
  readSearchParam,
  type SearchParams,
} from "../../../../../../lib/search-params";
import { saveExperienceForm } from "../../../../../../runtime/forms/actions";
import { FormRenderer } from "../../../../../../runtime/forms/form-renderer";
import { experiencePathToKey } from "../../../../../../runtime/routing";

interface NewRecordPageProps {
  params: Promise<{ businessSlug: string; screenSlug: string }>;
  searchParams: SearchParams;
}

export default async function NewRecordPage({
  params,
  searchParams,
}: Readonly<NewRecordPageProps>): Promise<ReactNode> {
  const { businessSlug, screenSlug } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  const experience = createExperienceService(supabase, {
    businessId: tenant.business.id,
  });
  const error = await readSearchParam(searchParams, "error");

  const { view, form } = await (async () => {
    try {
      const view = await experience.loadView(experiencePathToKey(screenSlug));
      const createFormKey =
        "create_form_key" in view.config
          ? view.config.create_form_key
          : undefined;
      if (!createFormKey) {
        notFound();
      }

      const form = await experience.loadForm(createFormKey);
      return { form, view };
    } catch {
      notFound();
    }
  })();

  if (
    form.definition.mode !== "create" ||
    form.definition.object_definition_id !==
      view.definition.object_definition_id
  ) {
    notFound();
  }

  const screenPath = `/app/${businessSlug}/workspace/${screenSlug}`;
  const formPath = `${screenPath}/new`;
  const action = saveExperienceForm.bind(
    null,
    businessSlug,
    form.definition.key,
    null,
    screenPath,
    formPath,
  );

  return (
    <section className="tenant-content runtime-form-page">
      {error ? <Notice kind="error">{error}</Notice> : null}
      <FormRenderer action={action} bundle={form} />
      <a className="back-link" href={screenPath}>
        ← Back to {view.definition.name}
      </a>
    </section>
  );
}
