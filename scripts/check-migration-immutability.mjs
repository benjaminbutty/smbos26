import { execFileSync } from "node:child_process";
import process from "node:process";

const baseRef = process.env.MIGRATION_BASE_REF ?? "origin/main";

function git(args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

try {
  git(["cat-file", "-e", `${baseRef}^{commit}`]);
} catch {
  globalThis.console.error(
    `Migration immutability check could not resolve base ref ${baseRef}.`,
  );
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  const baseMigrations = git([
    "ls-tree",
    "-r",
    "--name-only",
    baseRef,
    "supabase/migrations",
  ])
    .split("\n")
    .filter(Boolean);
  const changedBaseMigrations = [];

  for (const migrationPath of baseMigrations) {
    try {
      git(["diff", "--quiet", baseRef, "--", migrationPath]);
    } catch {
      changedBaseMigrations.push(migrationPath);
    }
  }

  if (changedBaseMigrations.length > 0) {
    globalThis.console.error("Historical migrations are immutable. Restore:");
    for (const migrationPath of changedBaseMigrations) {
      globalThis.console.error(`- ${migrationPath}`);
    }
    process.exitCode = 1;
  } else {
    globalThis.console.log(
      `Migration immutability check passed for ${baseMigrations.length} historical migrations.`,
    );
  }
}
