import type { MetadataRoute } from "next";

import { MARKETING_ORIGIN } from "./marketing-metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/outgrown-spreadsheets"],
      disallow: [
        "/app/",
        "/start/",
        "/sign-in",
        "/sign-up",
        "/onboarding",
        "/p/",
        "/api/",
      ],
    },
    sitemap: `${MARKETING_ORIGIN}/sitemap.xml`,
    host: MARKETING_ORIGIN,
  };
}
