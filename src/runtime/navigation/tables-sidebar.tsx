"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useActionState } from "react";

import type { DirectTableFormState } from "../views/direct-actions";

interface TablesSidebarProps {
  action: (
    previousState: DirectTableFormState,
    formData: FormData,
  ) => Promise<DirectTableFormState>;
  businessSlug: string;
  currentness: {
    expectedBaseVersionId: string;
    expectedHeadRevision: number;
  } | null;
  tables: ReadonlyArray<{ key: string; name: string; path: string }>;
}

const initialState: DirectTableFormState = { status: "idle" };

export function TablesSidebar({
  action,
  businessSlug,
  currentness,
  tables,
}: Readonly<TablesSidebarProps>): ReactNode {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, initialState);
  const pathname = usePathname();

  return (
    <section
      aria-labelledby="tables-navigation-heading"
      className="sidebar-section"
    >
      <div className="sidebar-section-heading">
        <h2 id="tables-navigation-heading">Tables</h2>
        {currentness ? (
          <button
            aria-expanded={open}
            aria-label="Create Table"
            className="sidebar-add-button"
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            +
          </button>
        ) : null}
      </div>
      {open && currentness ? (
        <form
          action={formAction}
          className="sidebar-create-form"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
        >
          <input
            name="expectedBaseVersionId"
            type="hidden"
            value={currentness.expectedBaseVersionId}
          />
          <input
            name="expectedHeadRevision"
            type="hidden"
            value={currentness.expectedHeadRevision}
          />
          <label>
            Table name
            <input
              autoFocus
              defaultValue="Untitled table"
              maxLength={120}
              minLength={1}
              name="title"
              required
            />
          </label>
          <button disabled={pending} type="submit">
            {pending ? "Creating…" : "Create Table"}
          </button>
          {state.status === "error" ? (
            <p className="inline-cell-error" role="alert">
              {state.message}
            </p>
          ) : null}
        </form>
      ) : null}
      <nav aria-label="Tables">
        {tables.length > 0 ? (
          tables.map((table) => {
            const href = `/app/${encodeURIComponent(businessSlug)}/workspace/${table.path}`;
            return (
              <Link
                aria-current={pathname === href ? "page" : undefined}
                className={pathname === href ? "selected" : undefined}
                href={href}
                key={table.key}
              >
                {table.name}
              </Link>
            );
          })
        ) : (
          <span className="sidebar-empty">No Tables yet</span>
        )}
      </nav>
    </section>
  );
}
