import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const versionedTables = [
  "object_definitions",
  "field_definitions",
  "relationship_definitions",
  "views",
  "forms",
  "pages",
  "preorder_experiences",
  "preorder_experience_locations",
] as const;
const revokedRpcNames = [
  "create_preorder_experience",
  "set_preorder_experience_locations",
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return [".ts", ".tsx"].includes(extname(path)) ? [path] : [];
  });
}

describe("production configuration mutation source boundary", () => {
  it("contains no direct versioned-table DML or legacy configuration RPC calls under src", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      for (const table of versionedTables) {
        const directDml = new RegExp(
          String.raw`\.from\(\s*["']${table}["']\s*\)\s*\.(?:insert|update|delete)\s*\(`,
          "s",
        );
        if (directDml.test(source)) {
          violations.push(
            `${relative(process.cwd(), file)}: direct ${table} DML`,
          );
        }
      }
      for (const rpc of revokedRpcNames) {
        const legacyCall = new RegExp(
          String.raw`\.rpc\(\s*["']${rpc}["']`,
          "s",
        );
        if (legacyCall.test(source)) {
          violations.push(
            `${relative(process.cwd(), file)}: legacy ${rpc} RPC`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
