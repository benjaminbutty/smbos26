import "server-only";

import { createHmac } from "node:crypto";

import { headers } from "next/headers";

import { getEnvironment } from "../../env";

export class SiteUploadRateLimitError extends Error {
  readonly code = "subject_unavailable" as const;

  constructor(options?: ErrorOptions) {
    super("The upload session is unavailable.", options);
    this.name = "SiteUploadRateLimitError";
  }
}

/**
 * Keep this server-only identity boundary aligned with acquisition service:
 * Vercel's platform signal is trusted; an unknown production proxy fails
 * closed. Local and CI requests use one deterministic loopback subject and do
 * not accept a caller-provided forwarding header.
 */
export function siteUploadNetworkSignalFromHeaders(input: {
  vercel: boolean;
  production: boolean;
  vercelForwardedFor?: string | null;
}): string | null {
  if (input.vercel) {
    const value = input.vercelForwardedFor?.split(",", 1)[0]?.trim();
    return value || null;
  }
  if (!input.production) return "local-development";
  return null;
}

export function siteUploadRateKey(
  networkSignal: string,
  secret: string | undefined,
  production: boolean,
): string | null {
  const signingSecret =
    secret ?? (production ? undefined : "local-acquisition-rate-limit-secret");
  if (!signingSecret) return null;
  return createHmac("sha256", signingSecret)
    .update(networkSignal, "utf8")
    .digest("hex");
}

export async function trustedSiteUploadSubjectHash(): Promise<string> {
  const environment = getEnvironment();
  const requestHeaders = await headers();
  const signal = siteUploadNetworkSignalFromHeaders({
    production: environment.NODE_ENV === "production",
    vercel: process.env.VERCEL === "1",
    vercelForwardedFor: requestHeaders.get("x-vercel-forwarded-for"),
  });
  const subjectHash = siteUploadRateKey(
    signal ?? "",
    environment.ACQUISITION_RATE_LIMIT_SECRET,
    environment.NODE_ENV === "production",
  );
  if (!signal || !subjectHash) throw new SiteUploadRateLimitError();
  return subjectHash;
}
