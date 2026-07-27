import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getEnvironment } from "../../env";
import type { Database } from "./database.types";

export async function refreshAuthSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = getEnvironment();

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, responseHeaders) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          response = NextResponse.next({ request });

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }

          for (const [name, value] of Object.entries(responseHeaders)) {
            response.headers.set(name, value);
          }
        },
      },
    },
  );

  // This must remain immediately after client creation so session refreshes
  // cannot accidentally be bypassed by future proxy logic.
  await supabase.auth.getClaims();

  return response;
}
