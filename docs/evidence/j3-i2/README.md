# J3-I2 Saved Views and Connections evidence

Captured on 22 August 2026 from `codex/j3-i2-saved-views-connections` against
the local Journey 3 generic proof seed. These files are durable acceptance
evidence; the proof businesses are reusable platform fixtures, not runtime
special cases.

## Owner-visible browser proof

Saved View, `Proof — Milk round / Standing Orders`:

- [1440×900 unsaved typed-query and exact-column preview](./saved-view-preview-1440x900.png)
- [1440×900 active shared tab after one Save view](./saved-view-active-tab-1440x900.png)
- [1024×768 anchored, internally scrolling editor](./saved-view-editor-1024x768.png)
- [390×844 deliberate full-screen editor](./saved-view-editor-390x844.png)
- [1440×900 retained stale draft with Save blocked](./saved-view-stale-draft-1440x900.png)
- [1440×900 Staff shared-tab operating state](./staff-shared-view-1440x900.png)

Connection, `Proof — Mobile dog groomer / Appointments`:

- [1440×900 proposed empty, non-operable Customer column](./connection-proposed-1440x900.png)
- [1024×768 complete owner-language Connection editor](./connection-editor-1024x768.png)
- [390×844 deliberate full-screen Connection editor](./connection-editor-390x844.png)

The browser pass verified:

- the unsaved Saved View preview returned one authoritative matching Record and
  persisted nothing;
- one `Save view` created `Open soon`, activated it as a Table tab, and did not
  add it to the sidebar;
- a later coherent name/query/column edit retained the same View key;
- focus returned to the active Saved View tab through the explicit focus target;
- a concurrent configuration change failed the stale save closed, retained the
  draft, disabled Save, and required `Refresh and recheck` plus a new preview;
- Staff could open the shared tab and operate the Table while `Create saved
  view`, `Edit saved view`, and `Add property` were absent;
- Connection setup asked both endpoint meanings, offered the inverse Property,
  explained empty existing Records and unlink behavior, and rendered proposed
  cells as `Empty · Not added yet`;
- one `Add connection` made the Connection operable and returned focus to its
  exact first Record cell after authoritative reload;
- selecting Aisha Khan and then clearing the value changed the operational edge
  count `0 → 1 → 0` while configuration stayed unchanged;
- document width equalled client width at 1440, 1024, and 390 pixels;
- browser warning/error logs were empty after Owner and Staff passes.

## Exact local configuration evidence

Before the browser Saved View create, the Milk round proof Business was at
head/Version `20/20`. Unsaved preview left it at `20/20`. The create and coherent
edit produced exactly these consecutive applied Changes:

```text
base revision 20 → Table Workspace: configure_saved_view
base revision 21 → Table Workspace: configure_saved_view
```

The separate stale-currentness setup and fixture restoration used two explicit
`rename_table` Changes at base revisions 22 and 23. The rejected stale save did
not advance the head.

Before Connection creation, the dog-groomer proof Business was at head/Version
`16/16` with three active relationships. After `Add connection` it was at
`17/17` with four. After operational select and unlink it remained `17/17`; the
new relationship edge count changed from zero to one and back to zero.

## Automated and database verification

The checkpoint was exercised with:

```text
npm run check
  90 files, 958 tests passed
npm run build
  production build passed
npm run test:integration -- tests/integration/internal-workspace-engine.test.ts tests/integration/direct-page-workspace.test.ts
  7 tests passed
npm run test:rls
  19 tests passed
npm run check:migration-immutability
  passed
npm run supabase:lint
  no errors
npm run workspace:proof:seed
  2 tests passed; four generic proof businesses retained locally
```

Focused unit coverage includes coherent Saved View create/update, typed query
validation, title/scalar retention, exact mixed columns and width pruning,
proposed Connection presentation, both endpoint multiplicities, existing
Connection reuse, owner-language consequence copy, and Staff structural-control
absence. The database-backed proof adds read-only preview isolation, stale
currentness, one-Version assertions, Page exact-key embed regression,
cross-Business rejection, and operational no-Version assertions.

No live provider evaluation was run.
