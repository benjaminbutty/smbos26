import type { ReactNode } from "react";

import "./reference.css";

export default function ReferenceLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactNode {
  return children;
}
