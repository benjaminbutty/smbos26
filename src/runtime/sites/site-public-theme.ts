import type { CSSProperties } from "react";

export type SitePublicAccent = "coral" | "clay" | "forest" | "ocean" | "plum";

type SitePublicAccentStyle = CSSProperties & {
  "--site-public-accent": string;
  "--site-public-accent-soft": string;
  "--site-public-accent-contrast": string;
};

const accentStyles: Record<SitePublicAccent, SitePublicAccentStyle> = {
  coral: {
    "--site-public-accent": "#d83a2f",
    "--site-public-accent-soft": "#fff1ef",
    "--site-public-accent-contrast": "#8f211b",
  },
  clay: {
    "--site-public-accent": "#a65c36",
    "--site-public-accent-soft": "#fbf1eb",
    "--site-public-accent-contrast": "#713b23",
  },
  forest: {
    "--site-public-accent": "#2f6f4e",
    "--site-public-accent-soft": "#edf6f0",
    "--site-public-accent-contrast": "#204b35",
  },
  ocean: {
    "--site-public-accent": "#2c6f9e",
    "--site-public-accent-soft": "#edf5fb",
    "--site-public-accent-contrast": "#1f527a",
  },
  plum: {
    "--site-public-accent": "#7a4d85",
    "--site-public-accent-soft": "#f6eff8",
    "--site-public-accent-contrast": "#583662",
  },
};

export function sitePublicAccentStyle(
  accent: SitePublicAccent,
): SitePublicAccentStyle {
  return accentStyles[accent];
}
