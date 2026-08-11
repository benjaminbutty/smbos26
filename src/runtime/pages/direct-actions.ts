"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { hasCapability, resolveTenant } from "../../auth/authorization";
import {
  DirectPageComposerError,
  directPageOwnerMessage,
} from "../../core/configuration/direct-pages/composer";
import {
  applyDirectPageAction,
  DirectPageServiceError,
} from "../../core/configuration/direct-pages/service";
import {
  directPageCurrentnessSchema,
  directPageIntentSchema,
} from "../../core/configuration/direct-pages/schemas";
import { pageLayoutSchema } from "../../core/experience/schemas";
import { createServerClient } from "../../db/supabase/server";

const businessSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const pageKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/);

export type DirectPageActionResult =
  | {
      status: "success";
      pageSlug: string;
      currentness: z.infer<typeof directPageCurrentnessSchema>;
      layout: z.infer<typeof pageLayoutSchema>;
    }
  | { status: "stale"; message: string }
  | { status: "error"; message: string };

function safeError(error: unknown): DirectPageActionResult {
  if (error instanceof DirectPageComposerError) {
    return { status: "error", message: directPageOwnerMessage(error.code) };
  }
  if (error instanceof DirectPageServiceError) {
    return {
      status: error.code === "direct_configuration_stale" ? "stale" : "error",
      message:
        error.code === "direct_configuration_stale"
          ? "This Page changed after it was loaded. Reload and try again."
          : error.message,
    };
  }
  if (error instanceof z.ZodError) {
    return {
      status: "error",
      message: "That Page change could not be completed safely.",
    };
  }
  return {
    status: "error",
    message:
      "That Page change could not be completed safely. Reload and try again.",
  };
}

function assertManageConfiguration(role: string): void {
  if (
    !hasCapability(
      role as Parameters<typeof hasCapability>[0],
      "manage_configuration",
    )
  ) {
    throw new Error("Owner or Admin access is required to edit Pages.");
  }
}

function pagePath(businessSlug: string, pageSlug: string): string {
  return `/app/${encodeURIComponent(businessSlug)}/pages/${pageSlug}`;
}

async function applyPageIntent(
  businessSlugInput: string,
  pageKeyInput: string,
  currentnessInput: unknown,
  intentInput: unknown,
): Promise<DirectPageActionResult> {
  try {
    const businessSlug = businessSlugSchema.parse(businessSlugInput);
    const pageKey = pageKeySchema.parse(pageKeyInput);
    const currentness = directPageCurrentnessSchema.parse(currentnessInput);
    const intent = directPageIntentSchema.parse(intentInput);
    if (intent.action !== "create_page" && intent.pageKey !== pageKey) {
      return {
        status: "error",
        message: "That Page is no longer the active Page.",
      };
    }

    const supabase = await createServerClient();
    const tenant = await resolveTenant(businessSlug, supabase);
    assertManageConfiguration(tenant.membership.role);
    const applied = await applyDirectPageAction(
      supabase,
      { businessId: tenant.business.id, actorId: tenant.user.id },
      { currentness, intent },
    );
    revalidatePath(pagePath(businessSlug, applied.composed.pageSlug), "page");
    revalidatePath(`/app/${encodeURIComponent(businessSlug)}`, "layout");
    return {
      status: "success",
      pageSlug: applied.composed.pageSlug,
      currentness: applied.currentness,
      layout: pageLayoutSchema.parse(
        applied.snapshot.pages.find(
          (page) => page.key === applied.composed.pageKey,
        )?.layout_json ?? { blocks: [] },
      ),
    };
  } catch (error) {
    return safeError(error);
  }
}

export async function savePageLayoutAction(
  businessSlug: string,
  pageKey: string,
  input: { currentness: unknown; layout: unknown },
): Promise<DirectPageActionResult> {
  const parsedLayout = pageLayoutSchema.safeParse(input.layout);
  if (!parsedLayout.success) {
    return {
      status: "error",
      message:
        "This Page content is not supported yet. Remove the invalid block and try again.",
    };
  }
  return applyPageIntent(businessSlug, pageKey, input.currentness, {
    action: "save_page_layout",
    pageKey,
    layout: parsedLayout.data,
  });
}

export async function renamePageAction(
  businessSlug: string,
  pageKey: string,
  input: { currentness: unknown; title: unknown },
): Promise<DirectPageActionResult> {
  const title = z.string().trim().min(1).max(120).safeParse(input.title);
  if (!title.success) {
    return { status: "error", message: "Page names must be 1–120 characters." };
  }
  return applyPageIntent(businessSlug, pageKey, input.currentness, {
    action: "rename_page",
    pageKey,
    title: title.data,
  });
}

export async function applyPageBlockAction(
  businessSlug: string,
  pageKey: string,
  input: { currentness: unknown; intent: unknown },
): Promise<DirectPageActionResult> {
  return applyPageIntent(
    businessSlug,
    pageKey,
    input.currentness,
    input.intent,
  );
}

export async function createPageAction(
  businessSlugInput: string,
  currentnessInput: unknown,
  formData: FormData,
): Promise<DirectPageActionResult> {
  const title = formData.get("title");
  return applyPageIntent(businessSlugInput, "new_page", currentnessInput, {
    action: "create_page",
    title: typeof title === "string" ? title : "",
  });
}
