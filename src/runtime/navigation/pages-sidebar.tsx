"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import type { DirectPageActionResult } from "../pages/direct-actions";

interface PagesSidebarProps {
  action?:
    ((formData: FormData) => Promise<DirectPageActionResult>) | undefined;
  businessSlug: string;
  currentness: {
    expectedBaseVersionId: string;
    expectedHeadRevision: number;
  } | null;
  pages: ReadonlyArray<{ id: string; slug: string; title: string }>;
}

export function PagesSidebar({
  action,
  businessSlug,
  currentness,
  pages,
}: Readonly<PagesSidebarProps>): ReactNode {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const requestedOpen = useSearchParams().get("new") === "page";
  const [open, setOpen] = useState(requestedOpen);

  useEffect(() => {
    if (!requestedOpen) return;
    const frame = window.requestAnimationFrame(() => {
      setOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedOpen]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!action) return;
    setPending(true);
    setMessage(null);
    try {
      const result = await action(new FormData(event.currentTarget));
      if (result.status === "success") {
        setOpen(false);
        router.push(
          `/app/${encodeURIComponent(businessSlug)}/pages/${result.pageSlug}`,
        );
        router.refresh();
      } else {
        setMessage(result.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      aria-labelledby="pages-navigation-heading"
      className="sidebar-section"
    >
      <div className="sidebar-section-heading">
        <h2 id="pages-navigation-heading">Pages</h2>
        {action && currentness ? (
          <button
            aria-expanded={open}
            aria-label="Create Page"
            className="sidebar-add-button"
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            +
          </button>
        ) : null}
      </div>
      {open && action && currentness ? (
        <form className="sidebar-create-form" onSubmit={submit}>
          <label>
            Page name
            <input
              autoFocus
              defaultValue="Untitled page"
              maxLength={120}
              minLength={1}
              name="title"
              required
            />
          </label>
          <button disabled={pending} type="submit">
            {pending ? "Creating…" : "Create Page"}
          </button>
          {message ? (
            <p className="inline-cell-error" role="alert">
              {message}
            </p>
          ) : null}
        </form>
      ) : null}
      <nav aria-label="Pages">
        {pages.length > 0 ? (
          pages.map((page) => {
            const href = `/app/${encodeURIComponent(businessSlug)}/pages/${page.slug}`;
            return (
              <Link
                aria-current={pathname === href ? "page" : undefined}
                className={pathname === href ? "selected" : undefined}
                href={href}
                key={page.id}
              >
                <span aria-hidden="true" className="workspace-nav-icon">
                  ▤
                </span>
                {page.title}
              </Link>
            );
          })
        ) : (
          <span className="sidebar-empty">No Pages yet</span>
        )}
      </nav>
    </section>
  );
}
