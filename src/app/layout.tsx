import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { AppShell } from "../components/app-shell";
import "react-data-grid/lib/styles.css";
import "./globals.css";

const pageTitle = "Run your business. Your way. · SMBOS";
const pageDescription =
  "A flexible operating platform for small businesses, shaped around how you actually work.";

export const marketingMetadata: Metadata = {
  title: {
    default: "Run your business. Your way.",
    template: "%s · SMBOS",
  },
  description:
    "SMBOS is a flexible operating platform for small businesses, shaped around how you actually work.",
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    type: "website",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: pageTitle,
    description: pageDescription,
    images: ["/og.png"],
  },
};

function requestOrigin(requestHeaders: Headers): URL {
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = forwardedHost ?? requestHeaders.get("host");
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim();

  if (host) {
    return new URL(`${forwardedProtocol ?? "https"}://${host}`);
  }

  return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
}

export async function generateMetadata(): Promise<Metadata> {
  const metadataBase = requestOrigin(await headers());
  const socialImage = new URL("/og.png", metadataBase).toString();

  return {
    ...marketingMetadata,
    metadataBase,
    openGraph: {
      title: pageTitle,
      description: pageDescription,
      type: "website",
      images: [socialImage],
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description: pageDescription,
      images: [socialImage],
    },
  };
}

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({
  children,
}: Readonly<RootLayoutProps>): ReactNode {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
