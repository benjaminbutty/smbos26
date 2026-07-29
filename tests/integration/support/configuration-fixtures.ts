import type { Sql } from "postgres";

import type { Database } from "../../../src/db/supabase/database.types";

type VersionedConfigurationTable =
  | "object_definitions"
  | "field_definitions"
  | "relationship_definitions"
  | "views"
  | "forms"
  | "pages"
  | "preorder_experiences"
  | "preorder_experience_locations";

type Row<Table extends VersionedConfigurationTable> =
  Database["public"]["Tables"][Table]["Row"];
type Insert<Table extends VersionedConfigurationTable> =
  Database["public"]["Tables"][Table]["Insert"];
type Update<Table extends VersionedConfigurationTable> =
  Database["public"]["Tables"][Table]["Update"];

interface DynamicSql {
  (template: TemplateStringsArray, ...parameters: unknown[]): Promise<unknown>;
  (value: unknown): unknown;
}

/**
 * Local integration-test fixture boundary.
 *
 * This helper requires the local database-owner connection reported by the
 * Supabase CLI. It is intentionally outside src/, cannot be bundled into the
 * application, and does not weaken grants or RLS. Ordinary fixture creation
 * keeps all integrity triggers enabled; tests that deliberately inject corrupt
 * state must opt into their own narrowly scoped trigger bypass.
 */
export function createConfigurationFixtures(sql: Sql) {
  return {
    async insert<Table extends VersionedConfigurationTable>(
      table: Table,
      values: Insert<Table> | Insert<Table>[],
    ): Promise<Row<Table>[]> {
      const rows = Array.isArray(values) ? values : [values];
      if (rows.length === 0) {
        return [];
      }
      // postgres.js cannot preserve the table-discriminated generic through
      // its identifier/value helper overloads, so keep the public method typed
      // and erase only the dynamic SQL-construction call.
      const query = sql as unknown as DynamicSql;
      return (await query`
        insert into ${query(table)}
        ${query(rows)}
        returning *
      `) as Row<Table>[];
    },

    async updateById<Table extends VersionedConfigurationTable>(
      table: Table,
      id: string,
      values: Update<Table>,
    ): Promise<Row<Table>> {
      const query = sql as unknown as DynamicSql;
      const [updated] = (await query`
        update ${query(table)}
        set ${query(values)}
        where id = ${id}::uuid
        returning *
      `) as Row<Table>[];
      if (!updated) {
        throw new Error(`Missing ${table} fixture ${id}.`);
      }
      return updated;
    },

    async deleteById<Table extends VersionedConfigurationTable>(
      table: Table,
      id: string,
    ): Promise<void> {
      const query = sql as unknown as DynamicSql;
      await query`
        delete from ${query(table)}
        where id = ${id}::uuid
      `;
    },
  };
}
