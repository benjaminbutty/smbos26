"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import {
  hasCapability,
  resolveTenant,
} from "../../../../../../auth/authorization";
import { createRecordLocationLinkService } from "../../../../../../core/graph/location-links";
import { createServerClient } from "../../../../../../db/supabase/server";

const uuidSchema = z.uuid();

function detailPath(
  businessSlug: string,
  screenSlug: string,
  recordId: string,
): string {
  return `/app/${encodeURIComponent(businessSlug)}/workspace/${encodeURIComponent(screenSlug)}/${encodeURIComponent(recordId)}`;
}

function formUuid(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== "string") return null;
  return uuidSchema.safeParse(value).data ?? null;
}

async function requireLocationManager(businessSlug: string) {
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  if (!hasCapability(tenant.membership.role, "manage_locations")) {
    notFound();
  }
  return { supabase, tenant };
}

export async function linkRecordToLocation(
  businessSlug: string,
  screenSlug: string,
  recordId: string,
  formData: FormData,
): Promise<never> {
  const destination = detailPath(businessSlug, screenSlug, recordId);
  const parsedRecordId = uuidSchema.safeParse(recordId);
  const locationId = formUuid(formData, "locationId");
  if (!parsedRecordId.success || !locationId) {
    redirect(
      `${destination}?error=${encodeURIComponent("Choose a valid Location.")}`,
    );
  }
  const { supabase, tenant } = await requireLocationManager(businessSlug);
  try {
    await createRecordLocationLinkService(supabase, {
      businessId: tenant.business.id,
    }).create(parsedRecordId.data, locationId);
  } catch {
    redirect(
      `${destination}?error=${encodeURIComponent("Availability could not be updated.")}`,
    );
  }
  revalidatePath(destination);
  redirect(
    `${destination}?message=${encodeURIComponent("Availability updated.")}`,
  );
}

export async function unlinkRecordFromLocation(
  businessSlug: string,
  screenSlug: string,
  recordId: string,
  formData: FormData,
): Promise<never> {
  const destination = detailPath(businessSlug, screenSlug, recordId);
  const parsedRecordId = uuidSchema.safeParse(recordId);
  const linkId = formUuid(formData, "linkId");
  const locationId = formUuid(formData, "locationId");
  if (!parsedRecordId.success || !linkId || !locationId) {
    redirect(
      `${destination}?error=${encodeURIComponent("Choose a valid connection.")}`,
    );
  }
  const { supabase, tenant } = await requireLocationManager(businessSlug);
  let staleConnection = false;
  try {
    const service = createRecordLocationLinkService(supabase, {
      businessId: tenant.business.id,
    });
    const pair = await service.readPair(parsedRecordId.data, locationId);
    if (!pair || pair.id !== linkId) {
      staleConnection = true;
    } else {
      await service.remove(pair.id);
    }
  } catch {
    redirect(
      `${destination}?error=${encodeURIComponent("Availability could not be updated.")}`,
    );
  }
  if (staleConnection) {
    redirect(
      `${destination}?error=${encodeURIComponent("That availability connection is no longer current.")}`,
    );
  }
  revalidatePath(destination);
  redirect(
    `${destination}?message=${encodeURIComponent("Availability updated.")}`,
  );
}
