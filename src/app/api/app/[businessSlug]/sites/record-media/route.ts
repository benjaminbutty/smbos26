import { NextResponse } from "next/server";
import { z } from "zod";

import { hasCapability } from "../../../../../../auth/capabilities";
import { resolveTenant } from "../../../../../../auth/authorization";
import {
  attachSiteRecordMedia,
  SiteFoundationServiceError,
} from "../../../../../../core/sites/service";
import { createServerClient } from "../../../../../../db/supabase/server";

interface RecordMediaRouteProps {
  params: Promise<{ businessSlug: string }>;
}

const inputSchema = z
  .object({
    siteId: z.uuid(),
    recordId: z.uuid(),
    objectDefinitionId: z.uuid(),
    fieldDefinitionId: z.uuid(),
    assetId: z.uuid(),
    expectedRecordRevision: z.number().int().positive(),
    expectedAttachmentRevision: z.number().int().nonnegative(),
  })
  .strict();

function errorResponse(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(
  request: Request,
  { params }: Readonly<RecordMediaRouteProps>,
): Promise<NextResponse> {
  const { businessSlug } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Record image input is invalid.");
  }
  const input = inputSchema.safeParse(body);
  if (!input.success) return errorResponse("Record image input is invalid.");

  const supabase = await createServerClient();
  let tenant;
  try {
    tenant = await resolveTenant(businessSlug, supabase);
  } catch {
    return errorResponse("Site unavailable.", 404);
  }
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    return errorResponse("Site unavailable.", 404);
  }

  try {
    const attachment = await attachSiteRecordMedia(
      supabase,
      { businessId: tenant.business.id, actorId: tenant.user.id },
      input.data,
    );
    return NextResponse.json({
      ok: true,
      attachmentRevision: attachment.attachment_revision,
    });
  } catch (error) {
    if (error instanceof SiteFoundationServiceError) {
      const stale = /stale/.test(error.code);
      return errorResponse(
        stale
          ? "The Record changed elsewhere. Reload before continuing."
          : "The Record image could not be attached.",
        stale ? 409 : 400,
      );
    }
    return errorResponse("The Record image could not be attached.", 500);
  }
}
