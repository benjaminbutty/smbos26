import type { Metadata } from "next";

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
