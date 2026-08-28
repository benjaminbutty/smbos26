import type { Metadata } from "next";

export const MARKETING_ORIGIN = "https://uselenni.com";

const pageTitle = "Your business, in one calm workspace. · Lenni";
const pageDescription =
  "Lenni is a flexible business workspace for small businesses, shaped around how you actually work.";

export const marketingMetadata: Metadata = {
  metadataBase: new URL(MARKETING_ORIGIN),
  title: {
    default: "Your business, in one calm workspace.",
    template: "%s · Lenni",
  },
  description:
    "Lenni is a flexible business workspace for small businesses, shaped around how you actually work.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    type: "website",
    url: "/",
    images: ["/og-lenni.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: pageTitle,
    description: pageDescription,
    images: ["/og-lenni.png"],
  },
};
