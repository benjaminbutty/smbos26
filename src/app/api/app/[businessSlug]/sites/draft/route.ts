import { NextResponse } from "next/server";

import { hasCapability } from "../../../../../../auth/capabilities";
import { resolveTenant } from "../../../../../../auth/authorization";
import { siteDraftSaveSchema } from "../../../../../../core/sites/schemas";
import {
  saveSiteDraft,
  SiteFoundationServiceError,
  siteStateSchema,
} from "../../../../../../core/sites/service";
import { createServerClient } from "../../../../../../db/supabase/server";

interface SiteDraftRouteProps {
  params: Promise<{ businessSlug: string }>;
}

type SiteStateReadQuery = {
  eq(column: string, value: string): SiteStateReadQuery;
  maybeSingle(): Promise<{ data: unknown | null; error: unknown | null }>;
};

type SiteStateReader = {
  from(table: "site_states"): {
    select(columns: "*"): SiteStateReadQuery;
  };
};

export async function GET(
  request: Request,
  { params }: Readonly<SiteDraftRouteProps>,
): Promise<NextResponse> {
  const { businessSlug } = await params;
  const siteId = new URL(request.url).searchParams.get("siteId");
  if (!siteId) {
    return NextResponse.json({ message: "Site unavailable." }, { status: 404 });
  }
  const supabase = await createServerClient();
  let tenant;
  try {
    tenant = await resolveTenant(businessSlug, supabase);
  } catch {
    return NextResponse.json({ message: "Site unavailable." }, { status: 404 });
  }
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    return NextResponse.json({ message: "Site unavailable." }, { status: 404 });
  }
  const stateReader = supabase as unknown as SiteStateReader;
  const stateResult = await stateReader
    .from("site_states")
    .select("*")
    .eq("business_id", tenant.business.id)
    .eq("id", siteId)
    .maybeSingle();
  if (stateResult.error || !stateResult.data) {
    return NextResponse.json({ message: "Site unavailable." }, { status: 404 });
  }
  const state = siteStateSchema.safeParse(stateResult.data);
  if (!state.success) {
    return NextResponse.json({ message: "Site unavailable." }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    siteId: state.data.id,
    draft: state.data.draft_json,
    draftRevision: state.data.draft_revision,
    draftBaseVersionId: state.data.draft_base_version_id,
    draftBaseHeadRevision: state.data.draft_base_head_revision,
  });
}

export async function POST(
  request: Request,
  { params }: Readonly<SiteDraftRouteProps>,
): Promise<NextResponse> {
  const { businessSlug } = await params;
  const supabase = await createServerClient();
  let tenant;
  try {
    tenant = await resolveTenant(businessSlug, supabase);
  } catch {
    return NextResponse.json({ message: "Site unavailable." }, { status: 404 });
  }
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    return NextResponse.json({ message: "Site unavailable." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Draft input is invalid." },
      { status: 400 },
    );
  }
  const input = siteDraftSaveSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json(
      { message: "Draft input is invalid." },
      { status: 400 },
    );
  }
  try {
    const state = await saveSiteDraft(
      supabase,
      { businessId: tenant.business.id, actorId: tenant.user.id },
      input.data,
    );
    return NextResponse.json({ ok: true, draftRevision: state.draft_revision });
  } catch (error) {
    if (error instanceof SiteFoundationServiceError) {
      return NextResponse.json(
        { message: "The draft changed elsewhere. Reload before continuing." },
        { status: /stale|rebase/.test(error.code) ? 409 : 400 },
      );
    }
    return NextResponse.json(
      { message: "Draft save failed." },
      { status: 500 },
    );
  }
}
