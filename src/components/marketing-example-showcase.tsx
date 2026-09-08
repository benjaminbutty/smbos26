"use client";

import { useState } from "react";
import styles from "../app/marketing-home.module.css";

type ExampleKey = "florist" | "trades" | "studio";

interface ExampleData {
  readonly name: string;
  readonly title: string;
  readonly third: string;
  readonly page: string;
  readonly view: string;
  readonly singular: string;
  readonly count: string;
  readonly quote: string;
  readonly understanding: string;
  readonly proposal: string;
  readonly rows: readonly [string, string, string][];
  readonly note: string;
}

const examples: Record<ExampleKey, ExampleData> = {
  florist: {
    name: "Petal & Stem",
    title: "Orders",
    third: "Event enquiries",
    page: "Studio notes",
    view: "Collection orders",
    singular: "Order",
    count: "3 orders",
    quote:
      "“Flowers for the everyday and the big days. I need to keep customers, orders and event enquiries together.”",
    understanding:
      "One studio. Everyday orders and special occasions. The same customers, with different things to keep track of.",
    proposal:
      "Customers, Orders and Event enquiries, connected around your studio.",
    rows: [
      ["The big birthday bouquet", "Alice Morgan", "Ready"],
      ["A little thank you", "Tom Lewis", "Ready"],
      ["Just because", "Sam Patel", "Preparing"],
    ],
    note: "A collection list based on the order details you keep in Lenni.",
  },
  trades: {
    name: "Good Work Maintenance",
    title: "Jobs",
    third: "Quotes",
    page: "Team notes",
    view: "Booked jobs",
    singular: "Job",
    count: "3 jobs",
    quote:
      "“We look after homes and small offices. I need to keep the customers, jobs and quotes straight as we grow.”",
    understanding:
      "One team. Repeat customers and one-off jobs. A clear trail from each customer to their work and quotes.",
    proposal:
      "Customers connected to Jobs, with Quotes connected to the job they belong to.",
    rows: [
      ["Kitchen finishing", "R. Whitfield", "Booked"],
      ["Garden gate repair", "Tom Lewis", "Booked"],
      ["Office repaint", "Sam Patel", "Booked"],
    ],
    note: "A list of jobs you’ve marked Booked. Quotes stay connected to their job.",
  },
  studio: {
    name: "Form & Field",
    title: "Projects",
    third: "Enquiries",
    page: "Studio notes",
    view: "Active projects",
    singular: "Project",
    count: "3 projects",
    quote:
      "“We’re a small design studio. I want our clients, projects and new enquiries in one place, in a way that feels like us.”",
    understanding:
      "A small studio balancing ongoing client work with new possibilities. A clearer view of who and what each project is for.",
    proposal:
      "Customers, Projects and Enquiries, with each piece of work connected to its customer.",
    rows: [
      ["A new identity", "Alice Morgan", "Active"],
      ["Autumn campaign", "Tom Lewis", "Active"],
      ["A shop’s next chapter", "Sam Patel", "Active"],
    ],
    note: "A list of projects you’ve marked Active. The same customer details stay connected.",
  },
};

const exampleButtons: readonly [ExampleKey, string][] = [
  ["florist", "A flower studio"],
  ["trades", "A maintenance business"],
  ["studio", "A creative studio"],
];

function initials(name: string): string {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("");
}

export function MarketingExampleShowcase(): React.ReactElement {
  const [selectedKey, setSelectedKey] = useState<ExampleKey>("florist");
  const example = examples[selectedKey];
  const firstRow = example.rows[0] ?? ["", "", ""];

  return (
    <>
      <div
        className={styles.exampleControls}
        role="group"
        aria-label="Choose an example business"
      >
        {exampleButtons.map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={selectedKey === key}
            aria-controls="example-workspace"
            onClick={() => setSelectedKey(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className={styles.demo}
        aria-label="Illustrative business description and workspace proposal"
      >
        <div className={styles.demoStory}>
          <div className={styles.storyStep}>
            <span className={styles.stepIndex}>01 / You describe it</span>
            <p className={styles.quote}>{example.quote}</p>
          </div>
          <div className={`${styles.storyStep} ${styles.understood}`}>
            <span className={styles.stepIndex}>02 / Lenni understands</span>
            <p>{example.understanding}</p>
          </div>
          <div className={`${styles.storyStep} ${styles.proposal}`}>
            <span className={styles.stepIndex}>
              03 / A starting point to review
            </span>
            <p>{example.proposal}</p>
            <p className={styles.ownerControl}>
              AI helps shape it. You decide.
            </p>
          </div>
        </div>

        <div className={styles.workspace} id="example-workspace">
          <div className={styles.workspaceTop}>
            <span>04 / Picture working here</span>
            <span className={styles.previewState}>Preview · example data</span>
          </div>
          <div className={styles.workspaceBody}>
            <aside
              className={styles.workspaceSidebar}
              aria-label="Illustrative workspace navigation"
            >
              <strong>{example.name}</strong>
              <span className={styles.sidebarMeta}>Your workspace</span>
              <span className={styles.sidebarSection}>Tables</span>
              <span className={`${styles.sideItem} ${styles.sideItemActive}`}>
                {example.title}
              </span>
              <span className={styles.sideItem}>Customers</span>
              <span className={styles.sideItem}>{example.third}</span>
              <span className={styles.sidebarSection}>Pages</span>
              <span className={styles.sideItem}>{example.page}</span>
              <span className={styles.tellLenni}>
                Tell Lenni <span aria-hidden="true">↗</span>
              </span>
            </aside>

            <div className={styles.workspaceMain}>
              <div className={styles.workspaceBreadcrumb}>
                {example.name} / {example.title}
              </div>
              <h3>{example.title}</h3>
              <div className={styles.viewBar}>
                <span className={styles.viewSelected}>{example.view}</span>
                <span className={styles.tableCount}>{example.count}</span>
              </div>
              <table className={styles.sampleTable}>
                <caption className={styles.srOnly}>
                  Illustrative {example.title.toLowerCase()} and their connected
                  customers
                </caption>
                <thead>
                  <tr>
                    <th>{example.singular}</th>
                    <th>Customer</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {example.rows.map(([work, customer, status]) => (
                    <tr key={work}>
                      <td data-label={example.singular}>{work}</td>
                      <td data-label="Customer">{customer}</td>
                      <td data-label="Status">
                        <span
                          className={`${styles.status} ${status === "Preparing" ? styles.neutralStatus : ""}`}
                        >
                          {status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={styles.connectionDetail}>
                <div className={styles.customerAvatar}>
                  {initials(firstRow[1])}
                </div>
                <div>
                  <strong>{firstRow[1]}</strong>
                  <p>{firstRow[0]}</p>
                </div>
                <span className={styles.connectionLabel}>
                  Connected customer
                </span>
              </div>
              <p className={styles.workspaceNote}>{example.note}</p>
            </div>
          </div>
        </div>
      </div>
      <div className={styles.demoCaption}>
        <span>
          Illustrative setup. You review the proposal before creating a
          workspace.
        </span>
        <span>
          Built to be changed by you. <span aria-hidden="true">↗</span>
        </span>
      </div>
      <p className={styles.srOnly} aria-live="polite">
        {example.name} example selected. {example.proposal}
      </p>
    </>
  );
}
