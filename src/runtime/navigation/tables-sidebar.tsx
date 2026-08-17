"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
  const [state, formAction, pending] = useActionState(action, initialState);
  const pathname = usePathname();
  const requestedOpen = useSearchParams().get("new") === "table";
  const [open, setOpen] = useState(requestedOpen);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!requestedOpen) return;
    const frame = window.requestAnimationFrame(() => {
      setOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedOpen]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        sectionRef.current &&
        !sectionRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [open]);

  return (
    <section
      aria-labelledby="tables-navigation-heading"
      className="sidebar-section"
      ref={sectionRef}
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
                <span aria-hidden="true" className="workspace-nav-icon">
                  ▦
                </span>
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
