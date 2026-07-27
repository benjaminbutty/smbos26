import Link from "next/link";
import type { ReactNode } from "react";

import { signOut } from "../../../auth/actions";
import { resolveTenant } from "../../../auth/authorization";

interface TenantLayoutProps {
  children: ReactNode;
  params: Promise<{ businessSlug: string }>;
}

export default async function TenantLayout({
  children,
  params,
}: Readonly<TenantLayoutProps>): Promise<ReactNode> {
  const { businessSlug } = await params;
  const tenant = await resolveTenant(businessSlug);

  return (
    <main className="tenant-page">
      <header className="tenant-header">
        <div>
          <Link className="tenant-name" href={`/app/${businessSlug}`}>
            {tenant.business.name}
          </Link>
          <span className="role-badge">{tenant.membership.role}</span>
        </div>
        <nav aria-label="Business">
          <Link href={`/app/${businessSlug}`}>Overview</Link>
          <Link href={`/app/${businessSlug}/locations`}>Locations</Link>
          <Link href="/onboarding">Switch business</Link>
          <form action={signOut}>
            <button className="button-link" type="submit">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      {children}
    </main>
  );
}
