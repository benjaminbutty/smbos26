import { describe, expect, it } from "vitest";

import {
  groupPageViewsByTable,
  selectPageView,
  selectPageViewTable,
  type PageViewOption,
} from "../src/runtime/page-editor/view-chooser";

const availableViews: readonly PageViewOption[] = [
  {
    key: "appointments_all",
    name: "All appointments",
    tableKey: "appointments",
    tableName: "Appointments",
    viewType: "table",
  },
  {
    key: "appointments_this_week",
    name: "This week",
    tableKey: "appointments",
    tableName: "Appointments",
    viewType: "table",
  },
  {
    key: "pets_by_customer",
    name: "Pets by Customer",
    tableKey: "pets",
    tableName: "Pets",
    viewType: "table",
  },
];

describe("Page Saved View chooser", () => {
  it("groups multiple saved Views under one Table while keeping each View selectable", () => {
    const tables = groupPageViewsByTable(availableViews);
    const appointments = tables.find((table) => table.key === "appointments");

    expect(tables.map((table) => table.label)).toEqual([
      "Appointments",
      "Pets",
    ]);
    expect(appointments?.views.map((view) => [view.name, view.key])).toEqual([
      ["All appointments", "appointments_all"],
      ["This week", "appointments_this_week"],
    ]);

    const appointmentsSelection = selectPageViewTable(tables, "appointments");
    expect(appointmentsSelection).toEqual({
      tableKey: "appointments",
      viewKey: "appointments_all",
    });
    expect(selectPageView(appointments, "appointments_this_week")).toBe(
      "appointments_this_week",
    );
    expect(selectPageView(appointments, "appointments_all")).toBe(
      "appointments_all",
    );
  });

  it("preselects the only eligible View when a Table has one", () => {
    const tables = groupPageViewsByTable(availableViews);

    expect(selectPageViewTable(tables, "pets")).toEqual({
      tableKey: "pets",
      viewKey: "pets_by_customer",
    });
  });
});
