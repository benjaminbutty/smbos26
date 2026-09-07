import { describe, expect, it } from "vitest";
import { CellWriteQueue } from "../src/runtime/editor-kernel/cell-write-queue";
import {
  tableGroups,
  tableVisualRowIndex,
} from "../src/runtime/editor-kernel/table-groups";
import type { EditorTable } from "../src/runtime/editor-kernel/contracts";

const table: EditorTable = {
  key: "jobs",
  name: "Jobs",
  primaryColumnKey: "name",
  columns: [
    { key: "name", label: "Name", kind: "text", width: 240 },
    { key: "status", label: "Status", kind: "status", width: 160 },
  ],
  grouping: {
    propertyKey: "field:status",
    counts: [
      { value: "Open", count: 125 },
      { value: null, count: 2 },
    ],
  },
  rows: [
    { id: "one", values: { name: "One", status: "Open" } },
    { id: "two", values: { name: "Two", status: null } },
    { id: "three", values: { name: "Three", status: "Open" } },
  ],
};
describe("table completion", () => {
  it("keeps database writes in entry order when a second edit would finish first", async () => {
    const queue = new CellWriteQueue();
    const events: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = queue.run(async () => {
      events.push("first starts");
      await blocked;
      events.push("first saved");
    });
    const second = queue.run(async () => {
      events.push("second saved");
    });
    await Promise.resolve();
    expect(events).toEqual(["first starts"]);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["first starts", "first saved", "second saved"]);
  });
  it("does not lose later writes after failure and permits an explicit retry", async () => {
    const queue = new CellWriteQueue();
    const first = queue.run(async () => {
      throw new Error("offline");
    });
    const next = queue.run(async () => "saved second");
    await expect(first).rejects.toThrow("offline");
    await expect(next).resolves.toBe("saved second");
    await expect(queue.run(async () => "retried first")).resolves.toBe(
      "retried first",
    );
  });
  it("separates loaded group members from complete-view counts and preserves sort order within groups", () => {
    const groups = tableGroups(table, table.rows);
    expect(
      groups.map((group) => [
        group.label,
        group.count,
        group.rows.map((row) => row.id),
      ]),
    ).toEqual([
      ["Open", 125, ["one", "three"]],
      ["No value", 2, ["two"]],
    ]);
  });
  it("restores focus by record identity after grouping and collapse", () => {
    expect(tableVisualRowIndex(table, table.rows, "three", new Set())).toBe(2);
    expect(
      tableVisualRowIndex(table, table.rows, "two", new Set(['"Open"'])),
    ).toBe(2);
    expect(
      tableVisualRowIndex(table, table.rows, "one", new Set(['"Open"'])),
    ).toBe(-1);
  });
  it("uses server connection labels for grouping and treats false as a real value", () => {
    const connected: EditorTable = {
      ...table,
      grouping: {
        propertyKey: "connection:customer:source",
        counts: [{ value: "Cafe", count: 10 }],
      },
      rows: [
        {
          id: "one",
          values: {},
          connectionValues: {
            "connection:customer:source": [{ id: "customer", label: "Cafe" }],
          },
        },
      ],
    };
    expect(tableGroups(connected, connected.rows)[0]).toMatchObject({
      label: "Cafe",
      count: 10,
    });
    expect(
      tableGroups(table, [{ id: "one", values: { status: false } }])[0]?.label,
    ).not.toBe("No value");
  });
});
