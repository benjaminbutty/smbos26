import type { MetadataRoute } from "next";

import { MARKETING_ORIGIN } from "./marketing-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${MARKETING_ORIGIN}/` },
    {
      url: `${MARKETING_ORIGIN}/guides/what-software-does-my-small-business-need`,
    },
    { url: `${MARKETING_ORIGIN}/outgrown-spreadsheets` },
  ];
}
