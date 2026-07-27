import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type {
  Database,
  Json,
  Tables,
  TablesUpdate,
} from "../../db/supabase/database.types";
import {
  createFieldDefinitionSchema,
  createObjectDefinitionSchema,
  createRecordRelationshipSchema,
  createRecordSchema,
  createRelationshipDefinitionSchema,
  queryRecordsSchema,
  updateFieldDefinitionSchema,
  updateObjectDefinitionSchema,
  updateRecordSchema,
  type CreateFieldDefinitionInput,
  type CreateObjectDefinitionInput,
  type CreateRecordInput,
  type CreateRecordRelationshipInput,
  type CreateRelationshipDefinitionInput,
  type QueryRecordsInput,
  type UpdateFieldDefinitionInput,
  type UpdateObjectDefinitionInput,
  type UpdateRecordInput,
} from "./schemas";

export class GraphServiceError extends Error {
  readonly code: string | null;

  constructor(message: string, cause?: PostgrestError | null) {
    super(message, { cause });
    this.name = "GraphServiceError";
    this.code = cause?.code ?? null;
  }
}

function requireResult<T>(
  data: T | null,
  error: PostgrestError | null,
  message: string,
): T {
  if (error || data === null) {
    throw new GraphServiceError(message, error);
  }

  return data;
}

export interface GraphService {
  createObjectDefinition(
    input: CreateObjectDefinitionInput,
  ): Promise<Tables<"object_definitions">>;
  updateObjectDefinition(
    input: UpdateObjectDefinitionInput,
  ): Promise<Tables<"object_definitions">>;
  archiveObjectDefinition(
    objectDefinitionId: string,
  ): Promise<Tables<"object_definitions">>;
  createFieldDefinition(
    input: CreateFieldDefinitionInput,
  ): Promise<Tables<"field_definitions">>;
  updateFieldDefinition(
    input: UpdateFieldDefinitionInput,
  ): Promise<Tables<"field_definitions">>;
  archiveFieldDefinition(
    fieldDefinitionId: string,
  ): Promise<Tables<"field_definitions">>;
  createRelationshipDefinition(
    input: CreateRelationshipDefinitionInput,
  ): Promise<Tables<"relationship_definitions">>;
  archiveRelationshipDefinition(
    relationshipDefinitionId: string,
  ): Promise<Tables<"relationship_definitions">>;
  createRecord(input: CreateRecordInput): Promise<Tables<"records">>;
  updateRecord(input: UpdateRecordInput): Promise<Tables<"records">>;
  archiveRecord(recordId: string): Promise<Tables<"records">>;
  createRecordRelationship(
    input: CreateRecordRelationshipInput,
  ): Promise<Tables<"record_relationships">>;
  removeRecordRelationship(recordRelationshipId: string): Promise<void>;
  queryRecords(input: QueryRecordsInput): Promise<Tables<"records">[]>;
}

export function createGraphService(
  client: SupabaseClient<Database>,
  tenant: { businessId: string },
): GraphService {
  const businessId = z.uuid().parse(tenant.businessId);

  return {
    async createObjectDefinition(input) {
      const value = createObjectDefinitionSchema.parse(input);
      const { data, error } = await client
        .from("object_definitions")
        .insert({
          business_id: businessId,
          key: value.key,
          singular_label: value.singularLabel,
          plural_label: value.pluralLabel,
          description: value.description,
          kind: value.kind,
          semantic_type: value.semanticType,
          icon: value.icon,
          is_active: value.isActive,
        })
        .select("*")
        .single();

      return requireResult(data, error, "Could not create object definition.");
    },

    async updateObjectDefinition(input) {
      const value = updateObjectDefinitionSchema.parse(input);
      const changes: TablesUpdate<"object_definitions"> = {};

      if (value.changes.singularLabel !== undefined) {
        changes.singular_label = value.changes.singularLabel;
      }
      if (value.changes.pluralLabel !== undefined) {
        changes.plural_label = value.changes.pluralLabel;
      }
      if (value.changes.description !== undefined) {
        changes.description = value.changes.description;
      }
      if (value.changes.semanticType !== undefined) {
        changes.semantic_type = value.changes.semanticType;
      }
      if (value.changes.icon !== undefined) {
        changes.icon = value.changes.icon;
      }
      if (value.changes.isActive !== undefined) {
        changes.is_active = value.changes.isActive;
      }

      const { data, error } = await client
        .from("object_definitions")
        .update(changes)
        .eq("business_id", businessId)
        .eq("id", value.objectDefinitionId)
        .select("*")
        .maybeSingle();

      return requireResult(data, error, "Could not update object definition.");
    },

    async archiveObjectDefinition(objectDefinitionId) {
      const { data, error } = await client
        .from("object_definitions")
        .update({ is_active: false })
        .eq("business_id", businessId)
        .eq("id", z.uuid().parse(objectDefinitionId))
        .select("*")
        .maybeSingle();

      return requireResult(data, error, "Could not archive object definition.");
    },

    async createFieldDefinition(input) {
      const value = createFieldDefinitionSchema.parse(input);
      const { data, error } = await client
        .from("field_definitions")
        .insert({
          business_id: businessId,
          object_definition_id: value.objectDefinitionId,
          key: value.key,
          label: value.label,
          field_type: value.fieldType,
          required: value.required,
          default_value: value.defaultValue,
          settings_json: value.settings,
          position: value.position,
          is_active: value.isActive,
        })
        .select("*")
        .single();

      return requireResult(data, error, "Could not create field definition.");
    },

    async updateFieldDefinition(input) {
      const value = updateFieldDefinitionSchema.parse(input);
      const changes: TablesUpdate<"field_definitions"> = {};

      if (value.changes.label !== undefined) {
        changes.label = value.changes.label;
      }
      if (value.changes.fieldType !== undefined) {
        changes.field_type = value.changes.fieldType;
      }
      if (value.changes.required !== undefined) {
        changes.required = value.changes.required;
      }
      if (value.changes.defaultValue !== undefined) {
        changes.default_value = value.changes.defaultValue;
      }
      if (value.changes.settings !== undefined) {
        changes.settings_json = value.changes.settings;
      }
      if (value.changes.position !== undefined) {
        changes.position = value.changes.position;
      }
      if (value.changes.isActive !== undefined) {
        changes.is_active = value.changes.isActive;
      }

      const { data, error } = await client
        .from("field_definitions")
        .update(changes)
        .eq("business_id", businessId)
        .eq("id", value.fieldDefinitionId)
        .select("*")
        .maybeSingle();

      return requireResult(data, error, "Could not update field definition.");
    },

    async archiveFieldDefinition(fieldDefinitionId) {
      const { data, error } = await client
        .from("field_definitions")
        .update({ is_active: false })
        .eq("business_id", businessId)
        .eq("id", z.uuid().parse(fieldDefinitionId))
        .select("*")
        .maybeSingle();

      return requireResult(data, error, "Could not archive field definition.");
    },

    async createRelationshipDefinition(input) {
      const value = createRelationshipDefinitionSchema.parse(input);
      const { data, error } = await client
        .from("relationship_definitions")
        .insert({
          business_id: businessId,
          key: value.key,
          source_object_definition_id: value.sourceObjectDefinitionId,
          target_object_definition_id: value.targetObjectDefinitionId,
          source_label: value.sourceLabel,
          target_label: value.targetLabel,
          cardinality: value.cardinality,
          is_required: value.isRequired,
          is_active: value.isActive,
        })
        .select("*")
        .single();

      return requireResult(
        data,
        error,
        "Could not create relationship definition.",
      );
    },

    async archiveRelationshipDefinition(relationshipDefinitionId) {
      const { data, error } = await client
        .from("relationship_definitions")
        .update({ is_active: false })
        .eq("business_id", businessId)
        .eq("id", z.uuid().parse(relationshipDefinitionId))
        .select("*")
        .maybeSingle();

      return requireResult(
        data,
        error,
        "Could not archive relationship definition.",
      );
    },

    async createRecord(input) {
      const value = createRecordSchema.parse(input);
      const { data, error } = await client.rpc("create_graph_record", {
        expected_business_id: businessId,
        target_object_definition_id: value.objectDefinitionId,
        requested_data: value.data,
        requested_record_status: value.recordStatus,
      });

      return requireResult(data, error, "Could not create record.");
    },

    async updateRecord(input) {
      const value = updateRecordSchema.parse(input);
      const args: Database["public"]["Functions"]["update_graph_record"]["Args"] =
        {
          expected_business_id: businessId,
          target_record_id: value.recordId,
          data_patch: value.dataPatch,
        };

      if (value.recordStatus !== undefined) {
        args.requested_record_status = value.recordStatus;
      }

      const { data, error } = await client.rpc("update_graph_record", args);
      return requireResult(data, error, "Could not update record.");
    },

    async archiveRecord(recordId) {
      const { data, error } = await client.rpc("archive_graph_record", {
        expected_business_id: businessId,
        target_record_id: z.uuid().parse(recordId),
      });

      return requireResult(data, error, "Could not archive record.");
    },

    async createRecordRelationship(input) {
      const value = createRecordRelationshipSchema.parse(input);
      const { data, error } = await client.rpc("create_graph_relationship", {
        expected_business_id: businessId,
        target_relationship_definition_id: value.relationshipDefinitionId,
        target_source_record_id: value.sourceRecordId,
        target_target_record_id: value.targetRecordId,
      });

      return requireResult(data, error, "Could not connect records.");
    },

    async removeRecordRelationship(recordRelationshipId) {
      const { data, error } = await client.rpc("remove_graph_relationship", {
        expected_business_id: businessId,
        target_record_relationship_id: z.uuid().parse(recordRelationshipId),
      });

      if (error || !data) {
        throw new GraphServiceError(
          "Could not remove record relationship.",
          error,
        );
      }
    },

    async queryRecords(input) {
      const value = queryRecordsSchema.parse(input);
      let query = client
        .from("records")
        .select("*")
        .eq("business_id", businessId)
        .eq("object_definition_id", value.objectDefinitionId)
        .order("created_at");

      if (!value.includeArchived) {
        query = query.eq("record_status", "active");
      }

      const { data, error } = await query;
      return requireResult(data, error, "Could not query records.");
    },
  };
}

export type GraphJson = Json;
