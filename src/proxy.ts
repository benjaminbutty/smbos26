import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { refreshAuthSession } from "./db/supabase/proxy";

const configurationPreviewPath =
  /^\/app\/[^/]+\/changes\/[^/]+\/preview\/[^/]+\/?$/;

const marketingOnlyPaths = new Set([
  "/",
  "/outgrown-spreadsheets",
  "/robots.txt",
  "/sitemap.xml",
]);

function normalizePathname(pathname: string): string {
  if (pathname === "/") {
    return pathname;
  }

  return pathname.replace(/\/+$/, "");
}

export function isMarketingOnlyMode(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.MARKETING_ONLY_MODE === "true";
}

export function rejectMarketingOnlyRoute(
  request: NextRequest,
  marketingOnly = isMarketingOnlyMode(),
): NextResponse | null {
  if (
    !marketingOnly ||
    marketingOnlyPaths.has(normalizePathname(request.nextUrl.pathname))
  ) {
    return null;
  }

  return new NextResponse("Not found.", {
    status: 404,
    headers: {
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

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
  const marketingOnlyRejection = rejectMarketingOnlyRoute(request);
  if (marketingOnlyRejection) {
    return marketingOnlyRejection;
  }

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
