import type { ReactNode } from "react";

interface NoticeProps {
  kind: "error" | "message";
  children: ReactNode;
}

export function Notice({ kind, children }: Readonly<NoticeProps>): ReactNode {
  return (
    <p
      className={`notice notice-${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
