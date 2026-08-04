"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireCapability, resolveTenant } from "../auth/authorization";
import { createServerClient } from "../db/supabase/server";
import {
  createLocationService,
  LocationServiceError,
  locationServiceOwnerMessage,
} from "../core/locations/service";

const businessSchema = z.object({
  name: z.string().trim().min(1).max(120),
  businessType: z.string().trim().min(1).max(80),
  timezone: z.string().trim().min(1).max(80),
});

const locationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  timezone: z.string().trim().min(1).max(80),
});

function redirectWithError(path: string, message: string): never {
  const params = new URLSearchParams({ error: message });
  redirect(`${path}?${params.toString()}`);
}

export async function createBusiness(formData: FormData): Promise<never> {
  const values = businessSchema.safeParse({
    name: formData.get("name"),
    businessType: formData.get("businessType"),
    timezone: formData.get("timezone"),
  });

  if (!values.success) {
    redirectWithError("/onboarding", "Complete all business details.");
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_business", {
    business_name: values.data.name,
    requested_business_type: values.data.businessType,
    requested_timezone: values.data.timezone,
  });

  if (error || !data) {
    redirectWithError(
      "/onboarding",
      "We could not create the business. Please try again.",
    );
  }

  redirect(`/app/${data.slug}`);
}

export async function createLocation(
  businessSlug: string,
  formData: FormData,
): Promise<never> {
  const values = locationSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone"),
  });
  const path = `/app/${businessSlug}/locations`;

  if (!values.success) {
    redirectWithError(path, "Enter a location name and timezone.");
  }

  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  requireCapability(tenant.membership.role, "manage_locations");

  try {
    const service = createLocationService(supabase, {
      businessId: tenant.business.id,
      actorId: tenant.user.id,
    });
    const state = await service.readCreationState();
    await service.create({
      name: values.data.name,
      timezone: values.data.timezone,
      expectedBusinessTimezone: state.business_timezone,
      expectedLocationStateDigest: state.location_state_digest,
    });
  } catch (error) {
    if (error instanceof LocationServiceError) {
      redirectWithError(path, locationServiceOwnerMessage(error.code));
    }
    redirectWithError(path, "We could not add that location.");
  }

  revalidatePath(path);
  redirect(`${path}?message=Location+added.`);
}

export async function updateLocation(
  businessSlug: string,
  locationId: string,
  formData: FormData,
): Promise<never> {
  const values = locationSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone"),
  });
  const path = `/app/${businessSlug}/locations`;

  if (!values.success) {
    redirectWithError(path, "Enter a location name and timezone.");
  }

  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  requireCapability(tenant.membership.role, "manage_locations");

  const { data, error } = await supabase
    .from("locations")
    .update({
      name: values.data.name,
      timezone: values.data.timezone,
    })
    .eq("id", locationId)
    .eq("business_id", tenant.business.id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    redirectWithError(path, "We could not update that location.");
  }

  revalidatePath(path);
  redirect(`${path}?message=Location+updated.`);
}

export async function deactivateLocation(
  businessSlug: string,
  locationId: string,
): Promise<never> {
  const path = `/app/${businessSlug}/locations`;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  requireCapability(tenant.membership.role, "manage_locations");

  const { data, error } = await supabase
    .from("locations")
    .update({ is_active: false })
    .eq("id", locationId)
    .eq("business_id", tenant.business.id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    redirectWithError(path, "We could not deactivate that location.");
  }

  revalidatePath(path);
  redirect(`${path}?message=Location+deactivated.`);
}
