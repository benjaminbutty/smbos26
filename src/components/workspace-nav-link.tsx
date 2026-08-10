"use client";

import Link, { type LinkProps } from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface WorkspaceNavLinkProps extends LinkProps {
  children: ReactNode;
  className?: string;
  exact?: boolean;
}

export function WorkspaceNavLink({
  children,
  className,
  exact = false,
  href,
  ...props
}: Readonly<WorkspaceNavLinkProps>): ReactNode {
  const pathname = usePathname();
  const target = typeof href === "string" ? href : (href.pathname ?? "");
  const active = exact
    ? pathname === target
    : pathname === target || pathname.startsWith(`${target}/`);

  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={className}
      href={href}
      {...props}
    >
      {children}
    </Link>
  );
}
