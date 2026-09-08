import type { Metadata } from "next";

export const MARKETING_ORIGIN = "https://uselenni.com";

const pageTitle = "For the business only you could build. · Lenni";
const pageDescription =
  "A flexible workspace shaped around how you work. Your customers, your plans, your next big thing.";

export const marketingMetadata: Metadata = {
  metadataBase: new URL(MARKETING_ORIGIN),
  title: {
    default: "For the business only you could build.",
    template: "%s · Lenni",
  },
  description: pageDescription,
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
