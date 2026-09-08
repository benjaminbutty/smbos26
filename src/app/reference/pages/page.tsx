import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { LenniBrand } from "../../../components/lenni-brand";

export const dynamic = "force-dynamic";

function ReferenceTable(): ReactNode {
  return (
    <section aria-label="Live orders Table" className="page-reference-table">
      <header>
        <div>
          <p>Orders</p>
          <strong>Today&apos;s collection</strong>
        </div>
        <a href="#open-table">Open table</a>
      </header>
      <div className="page-reference-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Collection</th>
              <th>Status</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Priya Shah</td>
              <td>09:30</td>
              <td>
                <span>Ready</span>
              </td>
              <td>£36.00</td>
            </tr>
            <tr>
              <td>Matt Carter</td>
              <td>10:15</td>
              <td>
                <span>Preparing</span>
              </td>
              <td>£18.50</td>
            </tr>
            <tr>
              <td>Rosie Bell</td>
              <td>11:00</td>
              <td>
                <span>New</span>
              </td>
              <td>£24.00</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="page-reference-mobile-records">
        <article>
          <strong>Priya Shah</strong>
          <span>09:30 · Ready · £36.00</span>
        </article>
        <article>
          <strong>Matt Carter</strong>
          <span>10:15 · Preparing · £18.50</span>
        </article>
        <article>
          <strong>Rosie Bell</strong>
          <span>11:00 · New · £24.00</span>
        </article>
      </div>
    </section>
  );
}

function ReferenceChecklist(): ReactNode {
  return (
    <section
      aria-label="Opening checklist"
      className="page-reference-checklist"
      id="opening-checklist"
    >
      <header>
        <div>
          <p>Opening checklist</p>
          <span>Shared from the daily preparation Table</span>
        </div>
      </header>
      <label>
        <input checked readOnly type="checkbox" />
        <span>Set the pastry counter</span>
      </label>
      <label>
        <input type="checkbox" />
        <span>Check collection labels</span>
      </label>
      <label>
        <input type="checkbox" />
        <span>Update the collection board</span>
      </label>
    </section>
  );
}

function DocumentReference(): ReactNode {
  return (
    <section className="page-reference-workspace">
      <aside className="page-reference-workspace-sidebar">
        <LenniBrand className="page-reference-wordmark" />
        <p>Bramble Bakery</p>
        <nav aria-label="Workspace navigation">
          <span>Home</span>
          <span>Tables</span>
          <span className="page-reference-nav-section">Pages</span>
          <strong>Daily operations</strong>
          <span>Collection notes</span>
          <span>Settings</span>
        </nav>
      </aside>
      <div className="page-reference-workspace-main">
        <header className="page-reference-mobile-workspace-header">
          <LenniBrand />
          <span>Pages</span>
        </header>
        <article className="page-reference-document">
          <header className="page-reference-topbar">
            <nav aria-label="Reference breadcrumb">
              <span>Pages</span>
              <span aria-hidden="true">/</span>
              <strong>Daily operations</strong>
            </nav>
            <span className="page-reference-save">Saved</span>
          </header>

          <div className="page-reference-prose">
            <input aria-label="Page title" defaultValue="Daily operations" />
            <p className="page-reference-lead">
              A simple guide for opening the shop, keeping collections moving
              and handing over a calm workspace to the next person.
            </p>
            <p>
              Start with the counter and the collection board. The orders below
              are live, so work from the list rather than copying details into
              this Page.
            </p>
          </div>

          <figure className="page-reference-image">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="A person preparing food in a kitchen"
              src="https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=1440&q=80"
            />
            <figcaption>
              Set up the work area before the first pickup.
            </figcaption>
          </figure>

          <div className="page-reference-prose">
            <details open>
              <summary>When a collection is late</summary>
              <p>
                Check the order status, then use the customer&apos;s preferred
                contact route. Leave the order in the Table so the team sees the
                same information.
              </p>
            </details>
          </div>

          <ReferenceChecklist />
          <ReferenceTable />

          <div className="page-reference-insertion" role="status">
            <span aria-hidden="true">+</span>
            <div>
              <strong>
                Type <kbd>/</kbd> to add a block
              </strong>
              <small>Text, heading, checklist, image or saved View</small>
            </div>
            <div
              aria-label="Block insertion menu"
              className="page-reference-slash-menu"
            >
              <button type="button">
                <strong>Text</strong>
                <span>Start writing</span>
              </button>
              <button type="button">
                <strong>Heading</strong>
                <span>Add structure</span>
              </button>
              <button type="button">
                <strong>Checklist</strong>
                <span>Shared daily work</span>
              </button>
              <button type="button">
                <strong>Saved View</strong>
                <span>Live business information</span>
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

export default function PageDesignReference(): ReactNode {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="page-design-reference">
      <section className="page-reference-introduction">
        <p>Lenni v2 · visual review</p>
        <h1>Internal Pages reference states</h1>
        <span>
          Development-only reference for hierarchy, density and contextual
          controls. It does not write Page data. The Table rows are simulated
          only to review the shared runtime&apos;s intended embed geometry.
        </span>
      </section>

      <section className="page-reference-states">
        <article className="page-reference-empty">
          <p>Empty Page</p>
          <input aria-label="Empty Page title" defaultValue="Untitled Page" />
          <div>
            <strong>Start writing</strong>
            <span>
              Type <kbd>/</kbd> for a block, or add a saved Table.
            </span>
          </div>
        </article>

        <article className="page-reference-selected">
          <p>Selected block</p>
          <div>
            <button aria-label="Add a block" type="button">
              +
            </button>
            <span>Check the collection board before 09:00.</span>
            <button aria-label="Move or edit the block" type="button">
              ⋮⋮
            </button>
          </div>
          <div
            aria-label="Text formatting menu"
            className="page-reference-format-menu"
          >
            <button type="button">
              <strong>B</strong>
            </button>
            <button type="button">
              <em>I</em>
            </button>
            <button type="button">Link</button>
          </div>
        </article>
      </section>

      <DocumentReference />
    </main>
  );
}
