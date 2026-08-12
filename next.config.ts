import type { NextConfig } from "next";

import { parseEnvironment } from "./src/env";

const isTypeGeneration = process.argv.some((argument) =>
  argument.includes("typegen"),
);

if (!isTypeGeneration) {
  parseEnvironment({
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    PREORDER_RATE_LIMIT_SECRET: process.env.PREORDER_RATE_LIMIT_SECRET,
    ACQUISITION_RATE_LIMIT_SECRET: process.env.ACQUISITION_RATE_LIMIT_SECRET,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_PROVIDER_API_KEY: process.env.AI_PROVIDER_API_KEY,
  });
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
