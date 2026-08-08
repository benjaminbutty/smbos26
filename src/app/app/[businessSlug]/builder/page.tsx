import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability } from "../../../../auth/authorization";
import {
  BuilderDisabledUi,
  BuilderUndoUi,
  BuilderUi,
} from "../../../../components/builder-ui";
import {
  BuilderUndoError,
  loadBuilderUndoContext,
  presentBuilderUndoContext,
} from "../../../../core/configuration/builder-undo/service";
import { isControlledConfigurationReadError } from "../../../../core/configuration/service";
import { createServerClient } from "../../../../db/supabase/server";
import {
  disableBuilderAction,
  enableBuilderAction,
  runBuilderAction,
} from "./actions";
import { parseBuilderRouteSlug, resolveBuilderTenant } from "./action-service";
import { prepareBuilderUndoAction } from "./undo-actions";
import { SupabaseAiAccountingService } from "../../../../ai/accounting/service";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
export const maxDuration = 120;

interface BuilderPageProps {
  params: Promise<{ businessSlug: string }>;
  searchParams?: Promise<{ undoVersion?: string | string[] }>;
}

export default async function BuilderPage({
  params,
  searchParams,
}: Readonly<BuilderPageProps>): Promise<ReactNode> {
  const { businessSlug: rawBusinessSlug } = await params;
  const businessSlug = parseBuilderRouteSlug(rawBusinessSlug);
  if (!businessSlug) {
    notFound();
  }

  const supabase = await createServerClient();
  const tenant = await resolveBuilderTenant(businessSlug, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    notFound();
  }

  const query = searchParams ? await searchParams : {};
  if (query.undoVersion !== undefined) {
    if (typeof query.undoVersion !== "string") {
      notFound();
    }
    let undoContext;
    try {
      undoContext = await loadBuilderUndoContext(supabase, {
        actorId: tenant.user.id,
        businessId: tenant.business.id,
        sourceVersionId: query.undoVersion,
      });
    } catch (error) {
      if (
        (error instanceof BuilderUndoError &&
          (error.code === "builder_undo_not_found" ||
            error.code === "builder_undo_invalid")) ||
        isControlledConfigurationReadError(error)
      ) {
        notFound();
      }
      throw error;
    }

    return (
      <BuilderUndoUi
        action={prepareBuilderUndoAction.bind(
          null,
          businessSlug,
          query.undoVersion,
        )}
        businessSlug={businessSlug}
        context={presentBuilderUndoContext(undoContext)}
      />
    );
  }

  const aiSettings = await new SupabaseAiAccountingService(supabase, {
    businessId: tenant.business.id,
    actorId: tenant.user.id,
  }).readSettings();

  if (!aiSettings.is_enabled) {
    return (
      <BuilderDisabledUi
        enableAction={enableBuilderAction.bind(null, businessSlug)}
      />
    );
  }

  return (
    <BuilderUi
      action={runBuilderAction.bind(null, businessSlug)}
      businessSlug={businessSlug}
      disableAction={disableBuilderAction.bind(null, businessSlug)}
    />
  );
}
