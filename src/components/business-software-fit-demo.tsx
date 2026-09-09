"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import styles from "../app/business-software-that-fits/business-software-that-fits.module.css";

export type FitExampleKey = "studio" | "trades" | "consultancy";
export type FitWorkspaceTable = "clients" | "enquiries" | "projects";
export type FitView = "all" | "waiting";

type FitTab = "words" | "stages" | "connected";

interface Enquiry {
  readonly id: string;
  readonly title: string;
  readonly client: string;
  readonly contact: string;
  readonly stage: string;
}

interface Project {
  readonly id: string;
  readonly title: string;
  readonly client: string;
  readonly status: string;
}

interface FitExampleDefinition {
  readonly name: string;
  readonly mark: string;
  readonly clientsLabel: string;
  readonly clientSingular: string;
  readonly workLabel: string;
  readonly workSingular: string;
  readonly leadLabel: string;
  readonly leadSingular: string;
  readonly stages: readonly string[];
  readonly suggestedStage: string;
  readonly description: string;
  readonly enquiries: readonly Enquiry[];
  readonly projects: readonly Project[];
}

export interface FitDemoState {
  readonly key: FitExampleKey;
  readonly name: string;
  readonly mark: string;
  readonly clientsLabel: string;
  readonly clientSingular: string;
  readonly workLabel: string;
  readonly workSingular: string;
  readonly leadLabel: string;
  readonly leadSingular: string;
  readonly stages: readonly string[];
  readonly suggestedStage: string;
  readonly description: string;
  readonly enquiries: readonly Enquiry[];
  readonly projects: readonly Project[];
}

export interface FitTableRow {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly status: string;
  readonly kind: FitWorkspaceTable;
}

const examples: Record<FitExampleKey, FitExampleDefinition> = {
  studio: {
    name: "Northline Studio",
    mark: "N",
    clientsLabel: "Clients",
    clientSingular: "Client",
    workLabel: "Projects",
    workSingular: "Project",
    leadLabel: "Enquiries",
    leadSingular: "Enquiry",
    stages: ["Brief received", "Waiting for reply", "Ready to scope"],
    suggestedStage: "Design agreed",
    description: "Keep the next conversation moving.",
    enquiries: [
      {
        id: "brand-refresh",
        title: "Brand refresh",
        client: "Olive House",
        contact: "Amelia Green",
        stage: "Brief received",
      },
      {
        id: "spring-collection",
        title: "Spring collection",
        client: "Sunday Store",
        contact: "Sophie Martin",
        stage: "Waiting for reply",
      },
      {
        id: "menu-packaging",
        title: "Menu & packaging",
        client: "Rowan Café",
        contact: "Noah Clarke",
        stage: "Ready to scope",
      },
      {
        id: "website-update",
        title: "Website update",
        client: "Local Makers",
        contact: "Finn Taylor",
        stage: "Brief received",
      },
    ],
    projects: [
      {
        id: "autumn-lookbook",
        title: "Autumn lookbook",
        client: "Olive House",
        status: "In progress",
      },
      {
        id: "store-launch",
        title: "Store launch",
        client: "Sunday Store",
        status: "Planning",
      },
      {
        id: "new-menu",
        title: "New menu",
        client: "Rowan Café",
        status: "In progress",
      },
    ],
  },
  trades: {
    name: "Oak & Co. Maintenance",
    mark: "O",
    clientsLabel: "Customers",
    clientSingular: "Customer",
    workLabel: "Jobs",
    workSingular: "Job",
    leadLabel: "Enquiries",
    leadSingular: "Enquiry",
    stages: ["Site visit needed", "Waiting for reply", "Ready to quote"],
    suggestedStage: "Materials confirmed",
    description: "Keep the next job moving.",
    enquiries: [
      {
        id: "kitchen-refresh",
        title: "Kitchen refresh",
        client: "Laura Bennett",
        contact: "Laura Bennett",
        stage: "Site visit needed",
      },
      {
        id: "shelving-fit-out",
        title: "Shelving fit-out",
        client: "North Street Café",
        contact: "Jack Turner",
        stage: "Waiting for reply",
      },
      {
        id: "built-in-storage",
        title: "Built-in storage",
        client: "Sam Williams",
        contact: "Sam Williams",
        stage: "Ready to quote",
      },
      {
        id: "repair-work",
        title: "Repair work",
        client: "Rose Cottage",
        contact: "Priya Patel",
        stage: "Site visit needed",
      },
    ],
    projects: [
      {
        id: "hallway-repairs",
        title: "Hallway repairs",
        client: "Laura Bennett",
        status: "In progress",
      },
      {
        id: "display-shelving",
        title: "Display shelving",
        client: "North Street Café",
        status: "Planning",
      },
      {
        id: "bookcase-fitting",
        title: "Bookcase fitting",
        client: "Sam Williams",
        status: "In progress",
      },
    ],
  },
  consultancy: {
    name: "Ellis & Co. Consulting",
    mark: "E",
    clientsLabel: "Clients",
    clientSingular: "Client",
    workLabel: "Engagements",
    workSingular: "Engagement",
    leadLabel: "Opportunities",
    leadSingular: "Opportunity",
    stages: ["Discovery", "Waiting for reply", "Proposal sent"],
    suggestedStage: "Scope agreed",
    description: "Keep the next opportunity in view.",
    enquiries: [
      {
        id: "team-workshop",
        title: "Team workshop",
        client: "Alba Works",
        contact: "Emily Roberts",
        stage: "Discovery",
      },
      {
        id: "growth-plan",
        title: "Growth plan",
        client: "Bright Goods",
        contact: "Oscar Hall",
        stage: "Waiting for reply",
      },
      {
        id: "process-review",
        title: "Process review",
        client: "Field Notes",
        contact: "Theo White",
        stage: "Proposal sent",
      },
      {
        id: "retail-strategy",
        title: "Retail strategy",
        client: "The Good Food Co.",
        contact: "Ada Hughes",
        stage: "Discovery",
      },
    ],
    projects: [
      {
        id: "team-planning",
        title: "Team planning",
        client: "Alba Works",
        status: "In progress",
      },
      {
        id: "market-research",
        title: "Market research",
        client: "Bright Goods",
        status: "Planning",
      },
      {
        id: "operations-workshop",
        title: "Operations workshop",
        client: "Field Notes",
        status: "In progress",
      },
    ],
  },
};

export function createFitDemoState(key: FitExampleKey): FitDemoState {
  const example = examples[key];

  return {
    key,
    ...example,
    stages: [...example.stages],
    enquiries: example.enquiries.map((enquiry) => ({ ...enquiry })),
    projects: example.projects.map((project) => ({ ...project })),
  };
}

export function getVisibleFitRows(
  workspace: FitDemoState,
  table: FitWorkspaceTable,
  view: FitView,
): readonly FitTableRow[] {
  if (table === "enquiries") {
    return workspace.enquiries
      .filter(
        (enquiry) =>
          view !== "waiting" || enquiry.stage === "Waiting for reply",
      )
      .map((enquiry) => ({
        id: enquiry.id,
        title: enquiry.title,
        subtitle: enquiry.client,
        status: enquiry.stage,
        kind: table,
      }));
  }

  if (table === "clients") {
    return workspace.enquiries.map((enquiry) => ({
      id: enquiry.id,
      title: enquiry.client,
      subtitle: enquiry.contact,
      status: "Active",
      kind: table,
    }));
  }

  return workspace.projects.map((project) => ({
    id: project.id,
    title: project.title,
    subtitle: project.client,
    status: project.status,
    kind: table,
  }));
}

interface DialogRequest {
  readonly kind: FitWorkspaceTable;
  readonly id: string;
}

interface FitDemoContextValue {
  readonly exampleKey: FitExampleKey;
  readonly workspace: FitDemoState;
  readonly revision: number;
  readonly table: FitWorkspaceTable;
  readonly view: FitView;
  readonly activeTab: FitTab;
  readonly notice: string;
  readonly dialog: DialogRequest | null;
  readonly selectExample: (key: FitExampleKey) => void;
  readonly resetExample: () => void;
  readonly setTable: (table: FitWorkspaceTable) => void;
  readonly setView: (view: FitView) => void;
  readonly setActiveTab: (tab: FitTab) => void;
  readonly updateNames: (singular: string, plural: string) => void;
  readonly addStage: (stage: string) => void;
  readonly updateEnquiryStage: (id: string, stage: string) => void;
  readonly openSampleRecord: (
    kind: FitWorkspaceTable,
    id: string,
    returnFocus: HTMLElement,
  ) => void;
  readonly closeSampleRecord: () => void;
}

const FitDemoContext = createContext<FitDemoContextValue | null>(null);

function useFitDemo(): FitDemoContextValue {
  const context = useContext(FitDemoContext);
  if (!context) {
    throw new Error(
      "Fit demo controls must be rendered inside FitDemoProvider.",
    );
  }
  return context;
}

export function FitDemoProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [exampleKey, setExampleKey] = useState<FitExampleKey>("studio");
  const [workspace, setWorkspace] = useState<FitDemoState>(() =>
    createFitDemoState("studio"),
  );
  const [table, setTableState] = useState<FitWorkspaceTable>("enquiries");
  const [view, setView] = useState<FitView>("all");
  const [activeTab, setActiveTab] = useState<FitTab>("stages");
  const [notice, setNotice] = useState(
    "Northline Studio example selected. Sample records only.",
  );
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [revision, setRevision] = useState(0);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const resetWorkspace = (key: FitExampleKey, message: string) => {
    setExampleKey(key);
    setWorkspace(createFitDemoState(key));
    setTableState("enquiries");
    setView("all");
    setActiveTab("stages");
    setDialog(null);
    setRevision((current) => current + 1);
    setNotice(message);
  };

  const value: FitDemoContextValue = {
    exampleKey,
    workspace,
    revision,
    table,
    view,
    activeTab,
    notice,
    dialog,
    selectExample: (key) => {
      resetWorkspace(
        key,
        `${examples[key].name} example selected. Sample records only.`,
      );
    },
    resetExample: () => {
      resetWorkspace(
        exampleKey,
        `${examples[exampleKey].name} has been reset to its sample records.`,
      );
    },
    setTable: (nextTable) => {
      setTableState(nextTable);
      setView("all");
    },
    setView,
    setActiveTab,
    updateNames: (singular, plural) => {
      setWorkspace((current) => ({
        ...current,
        clientSingular: singular,
        clientsLabel: plural,
      }));
      setNotice(`${plural} is now the name used in this local example.`);
    },
    addStage: (stage) => {
      setWorkspace((current) => ({
        ...current,
        stages: [...current.stages, stage],
      }));
      setNotice(`${stage} is ready to use in this local example.`);
    },
    updateEnquiryStage: (id, stage) => {
      setWorkspace((current) => ({
        ...current,
        enquiries: current.enquiries.map((enquiry) =>
          enquiry.id === id ? { ...enquiry, stage } : enquiry,
        ),
      }));
      setNotice("Example record updated. No real data has changed.");
    },
    openSampleRecord: (kind, id, returnFocus) => {
      returnFocusRef.current = returnFocus;
      setDialog({ kind, id });
    },
    closeSampleRecord: () => {
      setDialog(null);
      const returnFocus = returnFocusRef.current;
      window.requestAnimationFrame(() => {
        if (returnFocus?.isConnected) {
          returnFocus.focus();
          return;
        }

        document
          .getElementById(
            view === "waiting" ? "fit-view-waiting" : "fit-view-all",
          )
          ?.focus();
      });
    },
  };

  return (
    <FitDemoContext.Provider value={value}>{children}</FitDemoContext.Provider>
  );
}

function workspaceTableLabel(
  workspace: FitDemoState,
  table: FitWorkspaceTable,
): string {
  if (table === "clients") {
    return workspace.clientsLabel;
  }
  if (table === "projects") {
    return workspace.workLabel;
  }
  return workspace.leadLabel;
}

function stageTone(status: string, workspace: FitDemoState): string {
  if (status === "Active") {
    return styles.statusGreen ?? "";
  }
  if (status === "In progress") {
    return styles.statusGreen ?? "";
  }
  if (status === "Planning") {
    return styles.statusBlue ?? "";
  }

  const stageIndex = workspace.stages.indexOf(status);
  if (stageIndex === 1) {
    return styles.statusAmber ?? "";
  }
  if (stageIndex === 2) {
    return styles.statusGreen ?? "";
  }
  if (stageIndex > 2) {
    return styles.statusBlue ?? "";
  }
  return styles.statusPurple ?? "";
}

function StatusPill({
  status,
  workspace,
}: Readonly<{ status: string; workspace: FitDemoState }>) {
  return (
    <span className={`${styles.statusPill} ${stageTone(status, workspace)}`}>
      {status}
    </span>
  );
}

export function FitHeroWorkspace() {
  const {
    exampleKey,
    workspace,
    table,
    view,
    notice,
    selectExample,
    setTable,
    setView,
    openSampleRecord,
  } = useFitDemo();
  const rows = useMemo(
    () => getVisibleFitRows(workspace, table, view),
    [table, view, workspace],
  );
  const tableLabel = workspaceTableLabel(workspace, table);
  const tableSingular =
    table === "clients"
      ? workspace.clientSingular
      : table === "projects"
        ? workspace.workSingular
        : workspace.leadSingular;
  const tableOptions: readonly [FitWorkspaceTable, string][] = [
    ["clients", workspace.clientsLabel],
    ["enquiries", workspace.leadLabel],
    ["projects", workspace.workLabel],
  ];

  return (
    <div className={styles.heroDemo}>
      <p className={styles.heroAnnotation}>
        A little more like you. <span aria-hidden="true">↳</span>
      </p>
      <div
        className={styles.workspaceCard}
        aria-label="Interactive illustrative workspace"
      >
        <div className={styles.workspaceTopbar}>
          <div className={styles.workspaceIdentity}>
            <span className={styles.workspaceMark} aria-hidden="true">
              {workspace.mark}
            </span>
            <strong>{workspace.name}</strong>
          </div>
          <div className={styles.workspaceTopbarRight}>
            <span>Example workspace</span>
            <span className={styles.workspaceAvatar} aria-label="Example owner">
              ML
            </span>
          </div>
        </div>
        <div className={styles.workspaceBody}>
          <aside
            className={styles.workspaceSidebar}
            aria-label="Example workspace tables"
          >
            <span className={styles.workspaceEyebrow}>Your workspace</span>
            <div
              className={styles.workspaceNavigation}
              role="group"
              aria-label="Example workspace tables"
            >
              {tableOptions.map(([key, label]) => (
                <button
                  aria-pressed={table === key}
                  className={styles.workspaceNavigationButton}
                  key={key}
                  onClick={() => setTable(key)}
                  type="button"
                >
                  <span aria-hidden="true">
                    {key === "clients" ? "♧" : key === "enquiries" ? "▦" : "□"}
                  </span>
                  {label}
                </button>
              ))}
            </div>
            <span className={styles.workspaceMadeForYou}>
              <span aria-hidden="true">⌕</span> Made to be yours
            </span>
          </aside>
          <div className={styles.workspaceMain}>
            <div className={styles.workspaceTitleRow}>
              <h2>{tableLabel}</h2>
              <span className={styles.savedState}>✓ Saved</span>
            </div>
            <p className={styles.workspaceDescription}>
              {table === "enquiries"
                ? workspace.description
                : table === "clients"
                  ? "The people behind the work."
                  : "The work, and who it belongs to."}
            </p>
            <div className={styles.workspaceViews} aria-label="Example views">
              <button
                aria-pressed={view === "all"}
                className={styles.workspaceViewButton}
                id="fit-view-all"
                onClick={() => setView("all")}
                type="button"
              >
                All {tableLabel.toLowerCase()}{" "}
                <small>
                  {table === "projects"
                    ? workspace.projects.length
                    : workspace.enquiries.length}
                </small>
              </button>
              {table === "enquiries" ? (
                <button
                  aria-pressed={view === "waiting"}
                  className={styles.workspaceViewButton}
                  id="fit-view-waiting"
                  onClick={() => setView("waiting")}
                  type="button"
                >
                  Waiting for reply
                </button>
              ) : null}
            </div>
            <div className={styles.tableScroller}>
              <table className={styles.sampleTable}>
                <caption className={styles.srOnly}>
                  Illustrative {tableLabel.toLowerCase()}. Open a record to see
                  its local demo details.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">
                      {table === "clients"
                        ? workspace.clientSingular
                        : table === "projects"
                          ? `Work / ${workspace.clientSingular.toLowerCase()}`
                          : `${workspace.leadSingular} / ${workspace.clientSingular.toLowerCase()}`}
                    </th>
                    <th scope="col">
                      {table === "projects"
                        ? "Status"
                        : table === "clients"
                          ? "State"
                          : "Stage"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <button
                          className={styles.sampleRowButton}
                          onClick={(event) =>
                            openSampleRecord(
                              row.kind,
                              row.id,
                              event.currentTarget,
                            )
                          }
                          type="button"
                        >
                          <span>{row.title}</span>
                          <small>{row.subtitle}</small>
                        </button>
                      </td>
                      <td>
                        <StatusPill status={row.status} workspace={workspace} />
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td className={styles.emptyTable} colSpan={2}>
                        Nothing marked waiting for a reply.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className={styles.workspaceFooter}>
              <span>
                {rows.length}{" "}
                {(rows.length === 1 ? tableSingular : tableLabel).toLowerCase()}
                {view === "waiting" ? " · marked waiting" : ""}
              </span>
              <span>Open a row to explore ↗</span>
            </div>
          </div>
        </div>
      </div>
      <div
        className={styles.exampleSwitcher}
        role="group"
        aria-label="Choose an example business"
      >
        <span>Different business. Same Lenni.</span>
        {(
          [
            ["studio", "Studio"],
            ["trades", "Trades"],
            ["consultancy", "Consultancy"],
          ] as const
        ).map(([key, label]) => (
          <button
            aria-pressed={exampleKey === key}
            key={key}
            onClick={() => selectExample(key)}
            type="button"
          >
            <span aria-hidden="true">
              {key === "studio" ? "♧" : key === "trades" ? "⌕" : "▣"}
            </span>
            {label}
          </button>
        ))}
      </div>
      <p className={styles.demoCaption}>
        Interactive local demo. Sample records, not a live account.
      </p>
      <p className={styles.srOnly} aria-live="polite">
        {notice}
      </p>
    </div>
  );
}

const fitTabs: readonly {
  readonly key: FitTab;
  readonly number: string;
  readonly title: string;
  readonly detail: string;
}[] = [
  {
    key: "words",
    number: "01",
    title: "The words you use.",
    detail:
      "Clients, customers, members. Start with language your team already knows.",
  },
  {
    key: "stages",
    number: "02",
    title: "The way work happens.",
    detail:
      "Site visits, first drafts, waiting for a reply. Make room for your real stages.",
  },
  {
    key: "connected",
    number: "03",
    title: "The whole picture.",
    detail:
      "The customer and the work, together. Less piecing things back together.",
  },
];

export function FitDetailsExplorer() {
  const { revision, workspace } = useFitDemo();

  return <FitDetailsExplorerContent key={`${workspace.key}-${revision}`} />;
}

function FitDetailsExplorerContent() {
  const {
    activeTab,
    resetExample,
    workspace,
    setActiveTab,
    updateNames,
    addStage,
    openSampleRecord,
  } = useFitDemo();
  const [stageMode, setStageMode] = useState<
    "idle" | "form" | "review" | "applied"
  >("idle");
  const [stageDraft, setStageDraft] = useState(workspace.suggestedStage);
  const [stagePreview, setStagePreview] = useState("");
  const [stageError, setStageError] = useState("");
  const [singularDraft, setSingularDraft] = useState(workspace.clientSingular);
  const [pluralDraft, setPluralDraft] = useState(workspace.clientsLabel);
  const [namesPreview, setNamesPreview] = useState<{
    readonly singular: string;
    readonly plural: string;
  } | null>(null);
  const stageInputRef = useRef<HTMLInputElement>(null);
  const applyStageRef = useRef<HTMLButtonElement>(null);
  const addStageRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Partial<Record<FitTab, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (stageMode === "form") {
      stageInputRef.current?.focus();
      stageInputRef.current?.select();
    }
    if (stageMode === "review") {
      applyStageRef.current?.focus();
    }
  }, [stageMode]);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (
      ![
        "ArrowDown",
        "ArrowUp",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
      ].includes(event.key)
    ) {
      return;
    }

    event.preventDefault();
    const currentIndex = fitTabs.findIndex((tab) => tab.key === activeTab);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? fitTabs.length - 1
          : (currentIndex +
              (event.key === "ArrowDown" || event.key === "ArrowRight"
                ? 1
                : -1) +
              fitTabs.length) %
            fitTabs.length;
    const nextTab = fitTabs[nextIndex];
    if (!nextTab) {
      return;
    }
    setActiveTab(nextTab.key);
    window.requestAnimationFrame(() => tabRefs.current[nextTab.key]?.focus());
  };

  const previewStage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextStage = stageDraft.trim();
    if (!nextStage) {
      setStageError("Enter a name for this stage.");
      return;
    }
    if (
      workspace.stages.some(
        (stage) => stage.toLowerCase() === nextStage.toLowerCase(),
      )
    ) {
      setStageError("That stage already exists in this local example.");
      return;
    }
    setStageError("");
    setStagePreview(nextStage);
    setStageMode("review");
  };

  const applyStage = () => {
    addStage(stagePreview);
    setStageMode("applied");
    window.requestAnimationFrame(() => addStageRef.current?.focus());
  };

  const previewNames = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const singular = singularDraft.trim();
    const plural = pluralDraft.trim();
    if (!singular || !plural) {
      return;
    }
    setNamesPreview({ singular, plural });
  };

  const applyNames = () => {
    if (!namesPreview) {
      return;
    }
    updateNames(namesPreview.singular, namesPreview.plural);
    setNamesPreview(null);
  };

  const firstEnquiry = workspace.enquiries[0];
  const firstProject =
    workspace.projects.find(
      (project) => project.client === firstEnquiry?.client,
    ) ?? workspace.projects[0];

  return (
    <div className={styles.fitLayout}>
      <div
        className={styles.fitTabs}
        aria-label="Explore how the workspace adapts"
        role="tablist"
      >
        {fitTabs.map((tab) => (
          <button
            aria-controls="fit-demo-panel"
            aria-selected={activeTab === tab.key}
            className={styles.fitTab}
            id={`fit-tab-${tab.key}`}
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            onKeyDown={handleTabKeyDown}
            ref={(element) => {
              tabRefs.current[tab.key] = element;
            }}
            role="tab"
            tabIndex={activeTab === tab.key ? 0 : -1}
            type="button"
          >
            <span>{tab.number}</span>
            <span>
              <strong>{tab.title}</strong>
              <small>{tab.detail}</small>
            </span>
            <span aria-hidden="true">→</span>
          </button>
        ))}
      </div>
      <div
        aria-labelledby={`fit-tab-${activeTab}`}
        className={styles.fitPreview}
        id="fit-demo-panel"
        role="tabpanel"
        tabIndex={0}
      >
        <div className={styles.fitPreviewHead}>
          <span>
            <span aria-hidden="true">⌕</span> {workspace.name} · Make it yours
          </span>
          <small>Try a small change</small>
        </div>
        <div className={styles.fitEditor}>
          {activeTab === "stages" ? (
            <>
              <div className={styles.fitEditorTitle}>
                <div>
                  <h3>{workspace.leadLabel} · Your stages</h3>
                  <p>The steps that actually mean something to you.</p>
                </div>
                <span aria-hidden="true">▦</span>
              </div>
              <ul className={styles.stageList}>
                {workspace.stages.map((stage, index) => (
                  <StageCount
                    count={
                      workspace.enquiries.filter(
                        (enquiry) => enquiry.stage === stage,
                      ).length
                    }
                    index={index}
                    key={stage}
                    stage={stage}
                  />
                ))}
              </ul>
              <div className={styles.editorActions}>
                <button
                  className={styles.addStageButton}
                  onClick={() => setStageMode("form")}
                  ref={addStageRef}
                  type="button"
                >
                  <span aria-hidden="true">＋</span> Add your own stage
                </button>
                <button
                  className={styles.quietButton}
                  onClick={resetExample}
                  type="button"
                >
                  Reset example
                </button>
              </div>
              {stageMode === "form" ? (
                <form className={styles.stageForm} onSubmit={previewStage}>
                  <label htmlFor="fit-stage-name">
                    Name the new stage
                    <input
                      aria-describedby={
                        stageError ? "fit-stage-error" : undefined
                      }
                      aria-invalid={stageError ? true : undefined}
                      id="fit-stage-name"
                      maxLength={40}
                      onChange={(event) => {
                        setStageDraft(event.target.value);
                        setStageError("");
                      }}
                      ref={stageInputRef}
                      value={stageDraft}
                    />
                  </label>
                  <button className={styles.darkButton} type="submit">
                    Preview change <span aria-hidden="true">→</span>
                  </button>
                  {stageError ? (
                    <p
                      className={styles.formError}
                      id="fit-stage-error"
                      role="alert"
                    >
                      {stageError}
                    </p>
                  ) : null}
                </form>
              ) : null}
              {stageMode === "review" ? (
                <div className={styles.reviewBox}>
                  <strong>
                    Add “{stagePreview}” to {workspace.leadLabel}?
                  </strong>
                  <p>
                    Existing records keep their current stage. Nothing changes
                    until you apply this preview.
                  </p>
                  <div>
                    <button
                      className={styles.darkButton}
                      onClick={applyStage}
                      ref={applyStageRef}
                      type="button"
                    >
                      Apply to demo <span aria-hidden="true">✓</span>
                    </button>
                    <button
                      className={styles.quietButton}
                      onClick={() => setStageMode("idle")}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              {stageMode === "applied" ? (
                <p className={styles.reviewMessage} role="status">
                  ✓ “{stagePreview}” is ready to use in this local example.
                  Existing records are unchanged.
                </p>
              ) : null}
            </>
          ) : null}
          {activeTab === "words" ? (
            <>
              <div className={styles.fitEditorTitle}>
                <div>
                  <h3>Call it what you call it.</h3>
                  <p>A small change. A more familiar workspace.</p>
                </div>
                <span aria-hidden="true">⌕</span>
              </div>
              <form className={styles.namesForm} onSubmit={previewNames}>
                <label htmlFor="fit-singular-name">
                  One person or business
                  <input
                    id="fit-singular-name"
                    maxLength={30}
                    onChange={(event) => setSingularDraft(event.target.value)}
                    value={singularDraft}
                  />
                </label>
                <label htmlFor="fit-plural-name">
                  Your table name
                  <input
                    id="fit-plural-name"
                    maxLength={30}
                    onChange={(event) => setPluralDraft(event.target.value)}
                    value={pluralDraft}
                  />
                </label>
                <div className={styles.namesPreview}>
                  <span aria-hidden="true">♧</span>
                  <strong>{pluralDraft.trim() || "Your table name"}</strong>
                  <small>4 records</small>
                </div>
                <p>Try “Partners”, “Members” or the words your team uses.</p>
                <div className={styles.editorActions}>
                  <button className={styles.darkButton} type="submit">
                    Preview names <span aria-hidden="true">→</span>
                  </button>
                </div>
              </form>
              {namesPreview ? (
                <div className={styles.reviewBox}>
                  <strong>Review these names</strong>
                  <p>
                    Use “{namesPreview.singular}” for one record and “
                    {namesPreview.plural}” for the table. Existing records and
                    connections stay the same.
                  </p>
                  <div>
                    <button
                      className={styles.darkButton}
                      onClick={applyNames}
                      type="button"
                    >
                      Apply to demo <span aria-hidden="true">✓</span>
                    </button>
                    <button
                      className={styles.quietButton}
                      onClick={() => setNamesPreview(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          {activeTab === "connected" && firstEnquiry && firstProject ? (
            <>
              <div className={styles.fitEditorTitle}>
                <div>
                  <h3>The customer and the work.</h3>
                  <p>Already connected. Ready when you need them.</p>
                </div>
                <span aria-hidden="true">↗</span>
              </div>
              <div className={styles.connectedIdentity}>
                <span>{initials(firstEnquiry.client)}</span>
                <div>
                  <strong>{firstEnquiry.client}</strong>
                  <small>
                    {firstEnquiry.contact} · {workspace.clientSingular}
                  </small>
                </div>
              </div>
              <div className={styles.connectionGroup}>
                <span>↗ Connected {workspace.leadLabel.toLowerCase()}</span>
                <div>
                  <button
                    onClick={(event) =>
                      openSampleRecord(
                        "enquiries",
                        firstEnquiry.id,
                        event.currentTarget,
                      )
                    }
                    type="button"
                  >
                    {firstEnquiry.title} <span aria-hidden="true">→</span>
                  </button>
                  <StatusPill
                    status={firstEnquiry.stage}
                    workspace={workspace}
                  />
                </div>
              </div>
              <div className={styles.connectionGroup}>
                <span>□ Connected {workspace.workLabel.toLowerCase()}</span>
                <div>
                  <button
                    onClick={(event) =>
                      openSampleRecord(
                        "projects",
                        firstProject.id,
                        event.currentTarget,
                      )
                    }
                    type="button"
                  >
                    {firstProject.title} <span aria-hidden="true">→</span>
                  </button>
                  <StatusPill
                    status={firstProject.status}
                    workspace={workspace}
                  />
                </div>
              </div>
              <p className={styles.connectionFootnote}>
                Both records are explicitly linked to this{" "}
                {workspace.clientSingular.toLowerCase()}. No email or messages
                are being monitored.
              </p>
            </>
          ) : null}
        </div>
        <p className={styles.demoSafety}>
          <span aria-hidden="true">◇</span> This is a local demo. Preview a
          setup change before applying it.
        </p>
      </div>
    </div>
  );
}

function StageCount({
  count,
  index,
  stage,
}: Readonly<{ count: number; index: number; stage: string }>) {
  return (
    <li>
      <span>
        <i
          className={`${styles.stageDot} ${index === 1 ? styles.stageDotAmber : index === 2 ? styles.stageDotGreen : index > 2 ? styles.stageDotBlue : ""}`}
        />
        {stage}
      </span>
      <small>
        {count} {count === 1 ? "record" : "records"}
      </small>
    </li>
  );
}

function initials(value: string): string {
  return value
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function FitConnectedSnapshot() {
  const { workspace, openSampleRecord } = useFitDemo();
  const enquiry = workspace.enquiries[0];
  const project =
    workspace.projects.find((item) => item.client === enquiry?.client) ??
    workspace.projects[0];

  if (!enquiry || !project) {
    return null;
  }

  return (
    <div className={styles.linkedExample}>
      <div className={styles.linkedRecord}>
        <p className={styles.recordEyebrow}>
          ♧ {workspace.clientsLabel} / {workspace.clientSingular.toLowerCase()}{" "}
          details
        </p>
        <div className={styles.recordIdentity}>
          <span>{initials(enquiry.client)}</span>
          <div>
            <h3>{enquiry.client}</h3>
            <p>Independent homeware · {workspace.clientSingular}</p>
          </div>
        </div>
        <div className={styles.contactLine}>
          <span>Main contact</span>
          <strong>{enquiry.contact}</strong>
        </div>
        <div className={styles.relatedTitle}>
          <strong>Connected {workspace.leadLabel.toLowerCase()}</strong>
          <span>1 {workspace.leadSingular.toLowerCase()}</span>
        </div>
        <button
          className={styles.relatedRecord}
          onClick={(event) =>
            openSampleRecord("enquiries", enquiry.id, event.currentTarget)
          }
          type="button"
        >
          <span aria-hidden="true">↗</span>
          <span>
            <strong>{enquiry.title}</strong>
            <small>Linked to {enquiry.client}</small>
          </span>
          <StatusPill status={enquiry.stage} workspace={workspace} />
        </button>
        <div className={styles.relatedTitle}>
          <strong>Connected {workspace.workLabel.toLowerCase()}</strong>
          <span>1 {workspace.workSingular.toLowerCase()}</span>
        </div>
        <button
          className={styles.relatedRecord}
          onClick={(event) =>
            openSampleRecord("projects", project.id, event.currentTarget)
          }
          type="button"
        >
          <span aria-hidden="true">□</span>
          <span>
            <strong>{project.title}</strong>
            <small>Linked to {enquiry.client}</small>
          </span>
          <StatusPill status={project.status} workspace={workspace} />
        </button>
        <p className={styles.recordNote}>
          One {workspace.clientSingular.toLowerCase()}. Their enquiries and
          projects, close at hand.
        </p>
      </div>
      <div className={styles.linkedSticker}>
        <span aria-hidden="true">↗</span>
        <div>
          <strong>
            A familiar {workspace.clientSingular.toLowerCase()}. A connected
            picture.
          </strong>
          <p>No second customer list to keep up to date.</p>
        </div>
      </div>
      <p className={styles.linkedCaption}>
        Illustrative connected records · {workspace.name}
      </p>
    </div>
  );
}

function dialogContent(
  workspace: FitDemoState,
  request: DialogRequest,
):
  | {
      readonly title: string;
      readonly subtitle: string;
      readonly fields: readonly [string, string][];
      readonly note: string;
      readonly enquiryId?: string;
    }
  | undefined {
  if (request.kind === "enquiries") {
    const enquiry = workspace.enquiries.find((item) => item.id === request.id);
    if (!enquiry) {
      return undefined;
    }
    return {
      title: enquiry.title,
      subtitle: `${workspace.leadSingular} · ${enquiry.client}`,
      fields: [
        [`Connected ${workspace.clientSingular.toLowerCase()}`, enquiry.client],
        ["Contact", enquiry.contact],
      ],
      note: "This stage is a value the team tracks. Changing it updates this example table and its Waiting for reply view.",
      enquiryId: enquiry.id,
    };
  }

  if (request.kind === "clients") {
    const enquiry = workspace.enquiries.find((item) => item.id === request.id);
    if (!enquiry) {
      return undefined;
    }
    const project = workspace.projects.find(
      (item) => item.client === enquiry.client,
    );
    return {
      title: enquiry.client,
      subtitle: `${workspace.clientSingular} · ${enquiry.contact}`,
      fields: [
        ["Contact", enquiry.contact],
        [workspace.leadLabel, enquiry.title],
        [workspace.workLabel, project?.title ?? "No work linked yet"],
      ],
      note: `An ${workspace.leadSingular.toLowerCase()} and a ${workspace.workSingular.toLowerCase()} can each connect directly to the same ${workspace.clientSingular.toLowerCase()}. These are example connections, not imported information.`,
    };
  }

  const project = workspace.projects.find((item) => item.id === request.id);
  if (!project) {
    return undefined;
  }
  return {
    title: project.title,
    subtitle: `${workspace.workSingular} · ${project.client}`,
    fields: [
      [`Connected ${workspace.clientSingular.toLowerCase()}`, project.client],
      ["Status", project.status],
    ],
    note: "The team keeps this status up to date. This example does not schedule work, send messages or run automations.",
  };
}

export function FitRecordDialog() {
  const { closeSampleRecord, dialog, updateEnquiryStage, workspace } =
    useFitDemo();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const content = dialog ? dialogContent(workspace, dialog) : undefined;

  useEffect(() => {
    const element = dialogRef.current;
    if (dialog && element && !element.open) {
      element.showModal();
    }
    if (!dialog && element?.open) {
      element.close();
    }
  }, [dialog]);

  const dismissOnBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      event.currentTarget.close();
    }
  };

  return (
    <dialog
      aria-labelledby="fit-record-dialog-title"
      className={styles.recordDialog}
      onClick={dismissOnBackdrop}
      onClose={closeSampleRecord}
      ref={dialogRef}
    >
      {content ? (
        <article aria-labelledby="fit-record-dialog-title">
          <button
            aria-label="Close sample record"
            className={styles.dialogClose}
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            ×
          </button>
          <p className={styles.dialogEyebrow}>Example record · Local demo</p>
          <h2 id="fit-record-dialog-title">{content.title}</h2>
          <p className={styles.dialogSubtitle}>{content.subtitle}</p>
          <dl className={styles.dialogFields}>
            {content.fields.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
            {content.enquiryId ? (
              <div>
                <dt>
                  <label htmlFor="fit-record-stage">Stage</label>
                </dt>
                <dd>
                  <select
                    id="fit-record-stage"
                    onChange={(event) =>
                      updateEnquiryStage(
                        content.enquiryId ?? "",
                        event.target.value,
                      )
                    }
                    value={
                      workspace.enquiries.find(
                        (item) => item.id === content.enquiryId,
                      )?.stage
                    }
                  >
                    {workspace.stages.map((stage) => (
                      <option key={stage} value={stage}>
                        {stage}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
            ) : null}
          </dl>
          <p className={styles.dialogNote}>{content.note}</p>
          <p className={styles.dialogSafety}>
            Fictional sample information. Edits affect this browser preview only
            and reset when the page is reloaded.
          </p>
        </article>
      ) : null}
    </dialog>
  );
}
