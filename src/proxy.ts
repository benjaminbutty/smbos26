import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { refreshAuthSession } from "./db/supabase/proxy";

const configurationPreviewPath =
  /^\/app\/[^/]+\/changes\/[^/]+\/preview\/[^/]+\/?$/;

export function rejectConfigurationPreviewMutation(
  request: NextRequest,
): NextResponse | null {
  if (
    !configurationPreviewPath.test(request.nextUrl.pathname) ||
    request.method === "GET" ||
    request.method === "HEAD"
  ) {
    return null;
  }
  return NextResponse.json(
    { error: "Configuration preview is read-only." },
    {
      status: 405,
      headers: {
        allow: "GET, HEAD",
        "cache-control": "no-store",
      },
    },
  );
}

export async function proxy(request: NextRequest) {
  const rejected = rejectConfigurationPreviewMutation(request);
  if (rejected) {
    return rejected;
  }
  return refreshAuthSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
