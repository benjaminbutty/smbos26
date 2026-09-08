import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "../components/app-shell";
import { marketingMetadata } from "./marketing-metadata";
import "react-data-grid/lib/styles.css";
import "./globals.css";

export const metadata: Metadata = marketingMetadata;

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({
  children,
}: Readonly<RootLayoutProps>): ReactNode {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&display=swap"
        />
        <script
          defer
          crossOrigin="anonymous"
          data-website-id="cmtej8bsc0004q500nl740or8"
          src="https://jamp.io/main.js"
        />
        <script
          defer
          crossOrigin="anonymous"
          data-website-id="cmtej8bsc0004q500nl740or8"
          src="https://jamp.io/index.js"
        />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
