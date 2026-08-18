export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      ai_execution_runs: {
        Row: {
          actor_id: string;
          actual_cost_microusd: number | null;
          actual_input_tokens: number | null;
          actual_output_tokens: number | null;
          business_id: string;
          charged_cost_microusd: number;
          charged_input_tokens: number;
          charged_output_tokens: number;
          id: string;
          input_microusd_per_million: number;
          model_key: string;
          outcome_code: string | null;
          output_microusd_per_million: number;
          policy_key: string;
          provider_attempt_count: number;
          provider_invocation_started: boolean;
          provider_key: string;
          purpose_label: string;
          reserved_at: string;
          reserved_cost_microusd: number;
          reserved_input_tokens: number;
          reserved_output_tokens: number;
          reserved_request_count: number;
          settled_at: string | null;
          status: Database["public"]["Enums"]["ai_execution_status"];
          task_key: string;
          task_version: number;
          usage_complete: boolean;
          usage_day: string;
          usage_overrun: boolean;
        };
        Insert: {
          actor_id: string;
          actual_cost_microusd?: number | null;
          actual_input_tokens?: number | null;
          actual_output_tokens?: number | null;
          business_id: string;
          charged_cost_microusd?: number;
          charged_input_tokens?: number;
          charged_output_tokens?: number;
          id: string;
          input_microusd_per_million: number;
          model_key: string;
          outcome_code?: string | null;
          output_microusd_per_million: number;
          policy_key: string;
          provider_attempt_count?: number;
          provider_invocation_started?: boolean;
          provider_key: string;
          purpose_label: string;
          reserved_at?: string;
          reserved_cost_microusd: number;
          reserved_input_tokens: number;
          reserved_output_tokens: number;
          reserved_request_count?: number;
          settled_at?: string | null;
          status?: Database["public"]["Enums"]["ai_execution_status"];
          task_key: string;
          task_version: number;
          usage_complete?: boolean;
          usage_day: string;
          usage_overrun?: boolean;
        };
        Update: {
          actor_id?: string;
          actual_cost_microusd?: number | null;
          actual_input_tokens?: number | null;
          actual_output_tokens?: number | null;
          business_id?: string;
          charged_cost_microusd?: number;
          charged_input_tokens?: number;
          charged_output_tokens?: number;
          id?: string;
          input_microusd_per_million?: number;
          model_key?: string;
          outcome_code?: string | null;
          output_microusd_per_million?: number;
          policy_key?: string;
          provider_attempt_count?: number;
          provider_invocation_started?: boolean;
          provider_key?: string;
          purpose_label?: string;
          reserved_at?: string;
          reserved_cost_microusd?: number;
          reserved_input_tokens?: number;
          reserved_output_tokens?: number;
          reserved_request_count?: number;
          settled_at?: string | null;
          status?: Database["public"]["Enums"]["ai_execution_status"];
          task_key?: string;
          task_version?: number;
          usage_complete?: boolean;
          usage_day?: string;
          usage_overrun?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "ai_execution_runs_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      anonymous_build_daily_quotas: {
        Row: {
          attempt_count: number;
          attempt_day: string;
          created_at: string;
          rate_key: string;
          updated_at: string;
        };
        Insert: {
          attempt_count: number;
          attempt_day: string;
          created_at?: string;
          rate_key: string;
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          attempt_day?: string;
          created_at?: string;
          rate_key?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      anonymous_build_sessions: {
        Row: {
          attempt_count: number;
          claim_status: string;
          claimed_at: string | null;
          claimed_business_id: string | null;
          claimed_user_id: string | null;
          clarification_json: Json | null;
          created_at: string;
          accepted_candidate_checksum: string | null;
          accepted_at: string | null;
          expires_at: string;
          id: string;
          proposal_count: number;
          proposal_json: Json | null;
          regeneration_count: number;
          request_text: string | null;
          requested_category: string;
          successful_refinement_count: number;
          session_token_hash: string;
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          claim_status?: string;
          claimed_at?: string | null;
          claimed_business_id?: string | null;
          claimed_user_id?: string | null;
          clarification_json?: Json | null;
          created_at?: string;
          accepted_candidate_checksum?: string | null;
          accepted_at?: string | null;
          expires_at: string;
          id?: string;
          proposal_count?: number;
          proposal_json?: Json | null;
          regeneration_count?: number;
          request_text?: string | null;
          requested_category: string;
          successful_refinement_count?: number;
          session_token_hash: string;
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          claim_status?: string;
          claimed_at?: string | null;
          claimed_business_id?: string | null;
          claimed_user_id?: string | null;
          clarification_json?: Json | null;
          created_at?: string;
          accepted_candidate_checksum?: string | null;
          accepted_at?: string | null;
          expires_at?: string;
          id?: string;
          proposal_count?: number;
          proposal_json?: Json | null;
          regeneration_count?: number;
          request_text?: string | null;
          requested_category?: string;
          successful_refinement_count?: number;
          session_token_hash?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "anonymous_build_sessions_claimed_business_id_fkey";
            columns: ["claimed_business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      business_ai_settings: {
        Row: {
          business_id: string;
          created_at: string;
          daily_cost_limit_microusd: number;
          daily_input_token_limit: number;
          daily_output_token_limit: number;
          daily_request_limit: number;
          is_enabled: boolean;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          daily_cost_limit_microusd?: number;
          daily_input_token_limit?: number;
          daily_output_token_limit?: number;
          daily_request_limit?: number;
          is_enabled?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          daily_cost_limit_microusd?: number;
          daily_input_token_limit?: number;
          daily_output_token_limit?: number;
          daily_request_limit?: number;
          is_enabled?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "business_ai_settings_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: true;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      business_configuration_heads: {
        Row: {
          active_version_id: string;
          business_id: string;
          head_revision: number;
          updated_at: string;
        };
        Insert: {
          active_version_id: string;
          business_id: string;
          head_revision?: number;
          updated_at?: string;
        };
        Update: {
          active_version_id?: string;
          business_id?: string;
          head_revision?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "business_configuration_heads_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: true;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "business_configuration_heads_tenant_version_fkey";
            columns: ["business_id", "active_version_id"];
            isOneToOne: false;
            referencedRelation: "configuration_versions";
            referencedColumns: ["business_id", "id"];
          },
        ];
      };
      business_memberships: {
        Row: {
          business_id: string;
          created_at: string;
          id: string;
          permissions_json: Json;
          role: Database["public"]["Enums"]["business_role"];
          user_id: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          id?: string;
          permissions_json?: Json;
          role: Database["public"]["Enums"]["business_role"];
          user_id: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          id?: string;
          permissions_json?: Json;
          role?: Database["public"]["Enums"]["business_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "business_memberships_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      businesses: {
        Row: {
          business_type: string;
          created_at: string;
          id: string;
          name: string;
          settings_json: Json;
          slug: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          business_type: string;
          created_at?: string;
          id?: string;
          name: string;
          settings_json?: Json;
          slug: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          business_type?: string;
          created_at?: string;
          id?: string;
          name?: string;
          settings_json?: Json;
          slug?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      configuration_change_sets: {
        Row: {
          applied_at: string | null;
          applied_by: string | null;
          applied_version_id: string | null;
          base_head_revision: number;
          base_version_id: string;
          business_id: string;
          candidate_checksum: string;
          candidate_snapshot_json: Json;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          description: string | null;
          display_context_json: Json;
          id: string;
          id_allocations_json: Json;
          kind: Database["public"]["Enums"]["configuration_change_kind"];
          operations_json: Json;
          operations_schema_version: number;
          requested_by: string;
          rollback_target_version_id: string | null;
          semantic_diff_json: Json;
          status: Database["public"]["Enums"]["configuration_change_status"];
          title: string;
          updated_at: string;
          validated_at: string | null;
          validated_by: string | null;
          validation_result_json: Json | null;
        };
        Insert: {
          applied_at?: string | null;
          applied_by?: string | null;
          applied_version_id?: string | null;
          base_head_revision: number;
          base_version_id: string;
          business_id: string;
          candidate_checksum: string;
          candidate_snapshot_json: Json;
          closed_at?: string | null;
          closed_by?: string | null;
          created_at?: string;
          description?: string | null;
          display_context_json: Json;
          id?: string;
          id_allocations_json: Json;
          kind: Database["public"]["Enums"]["configuration_change_kind"];
          operations_json: Json;
          operations_schema_version: number;
          requested_by: string;
          rollback_target_version_id?: string | null;
          semantic_diff_json: Json;
          status?: Database["public"]["Enums"]["configuration_change_status"];
          title: string;
          updated_at?: string;
          validated_at?: string | null;
          validated_by?: string | null;
          validation_result_json?: Json | null;
        };
        Update: {
          applied_at?: string | null;
          applied_by?: string | null;
          applied_version_id?: string | null;
          base_head_revision?: number;
          base_version_id?: string;
          business_id?: string;
          candidate_checksum?: string;
          candidate_snapshot_json?: Json;
          closed_at?: string | null;
          closed_by?: string | null;
          created_at?: string;
          description?: string | null;
          display_context_json?: Json;
          id?: string;
          id_allocations_json?: Json;
          kind?: Database["public"]["Enums"]["configuration_change_kind"];
          operations_json?: Json;
          operations_schema_version?: number;
          requested_by?: string;
          rollback_target_version_id?: string | null;
          semantic_diff_json?: Json;
          status?: Database["public"]["Enums"]["configuration_change_status"];
          title?: string;
          updated_at?: string;
          validated_at?: string | null;
          validated_by?: string | null;
          validation_result_json?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "configuration_change_sets_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "configuration_change_sets_tenant_applied_version_fkey";
            columns: ["business_id", "applied_version_id"];
            isOneToOne: false;
            referencedRelation: "configuration_versions";
            referencedColumns: ["business_id", "id"];
          },
          {
            foreignKeyName: "configuration_change_sets_tenant_base_version_fkey";
            columns: ["business_id", "base_version_id"];
            isOneToOne: false;
            referencedRelation: "configuration_versions";
            referencedColumns: ["business_id", "id"];
          },
          {
            foreignKeyName: "configuration_change_sets_tenant_rollback_target_fkey";
            columns: ["business_id", "rollback_target_version_id"];
            isOneToOne: false;
            referencedRelation: "configuration_versions";
            referencedColumns: ["business_id", "id"];
          },
        ];
      };
      configuration_versions: {
        Row: {
          business_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          kind: Database["public"]["Enums"]["configuration_version_kind"];
          parent_version_id: string | null;
          restored_from_version_id: string | null;
          snapshot_checksum: string;
          snapshot_json: Json;
          snapshot_schema_version: number;
          source_change_set_id: string | null;
          version_number: number;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind: Database["public"]["Enums"]["configuration_version_kind"];
          parent_version_id?: string | null;
          restored_from_version_id?: string | null;
          snapshot_checksum: string;
          snapshot_json: Json;
          snapshot_schema_version: number;
          source_change_set_id?: string | null;
          version_number: number;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["configuration_version_kind"];
          parent_version_id?: string | null;
          restored_from_version_id?: string | null;
          snapshot_checksum?: string;
          snapshot_json?: Json;
          snapshot_schema_version?: number;
          source_change_set_id?: string | null;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "configuration_versions_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "configuration_versions_tenant_parent_fkey";
            columns: ["business_id", "parent_version_id"];
            isOneToOne: false;
            referencedRelation: "configuration_versions";
            referencedColumns: ["business_id", "id"];
          },
          {
            foreignKeyName: "configuration_versions_tenant_restored_from_fkey";
            columns: ["business_id", "restored_from_version_id"];
            isOneToOne: false;
            referencedRelation: "configuration_versions";
            referencedColumns: ["business_id", "id"];
          },
          {
            foreignKeyName: "configuration_versions_tenant_source_change_set_fkey";
            columns: ["business_id", "source_change_set_id"];
            isOneToOne: false;
            referencedRelation: "configuration_change_sets";
            referencedColumns: ["business_id", "id"];
          },
        ];
      };
      field_definitions: {
        Row: {
          business_id: string;
          created_at: string;
          default_value: Json | null;
          field_type: Database["public"]["Enums"]["graph_field_type"];
          id: string;
          is_active: boolean;
          key: string;
          label: string;
          object_definition_id: string;
          position: number;
          required: boolean;
          settings_json: Json;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          default_value?: Json | null;
          field_type: Database["public"]["Enums"]["graph_field_type"];
          id?: string;
          is_active?: boolean;
          key: string;
          label: string;
          object_definition_id: string;
          position?: number;
          required?: boolean;
          settings_json?: Json;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          default_value?: Json | null;
          field_type?: Database["public"]["Enums"]["graph_field_type"];
          id?: string;
          is_active?: boolean;
          key?: string;
          label?: string;
          object_definition_id?: string;
          position?: number;
          required?: boolean;
          settings_json?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "field_definitions_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "field_definitions_tenant_object_fkey";
            columns: ["business_id", "object_definition_id"];
            isOneToOne: false;
            referencedRelation: "object_definitions";
            referencedColumns: ["business_id", "id"];
          },
        ];
      };
      forms: {
        Row: {
          audience: Database["public"]["Enums"]["experience_audience"];
          business_id: string;
          config_json: Json;
          created_at: string;
          id: string;
          is_active: boolean;
          key: string;
          mode: Database["public"]["Enums"]["experience_form_mode"];
          name: string;
          object_definition_id: string;
          updated_at: string;
        };
        Insert: {
          audience?: Database["public"]["Enums"]["experience_audience"];
          business_id: string;
          config_json: Json;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          key: string;
          mode: Database["public"]["Enums"]["experience_form_mode"];
          name: string;
          object_definition_id: string;
          updated_at?: string;
        };
        Update: {
          audience?: Database["public"]["Enums"]["experience_audience"];
          business_id?: string;
          config_json?: Json;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          key?: string;
          mode?: Database["public"]["Enums"]["experience_form_mode"];
          name?: string;
          object_definition_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "forms_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "forms_tenant_object_fkey";
            columns: ["business_id", "object_definition_id"];
            isOneToOne: false;
            referencedRelation: "object_definitions";
            referencedColumns: ["business_id", "id"];
          },
        ];
      };
      locations: {
        Row: {
          address_json: Json;
          business_id: string;
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          opening_hours_json: Json;
          settings_json: Json;
          slug: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          address_json?: Json;
          business_id: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          opening_hours_json?: Json;
          settings_json?: Json;
          slug: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          address_json?: Json;
          business_id?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          opening_hours_json?: Json;
          settings_json?: Json;
          slug?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "locations_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      marketing_waitlist_signups: {
        Row: {
          business_type: string | null;
          created_at: string;
          email: string;
          id: string;
        };
        Insert: {
          business_type?: string | null;
          created_at?: string;
          email: string;
          id?: string;
        };
        Update: {
          business_type?: string | null;
          created_at?: string;
          email?: string;
          id?: string;
        };
        Relationships: [];
      };
      object_definitions: {
        Row: {
          business_id: string;
          created_at: string;
          description: string;
          icon: string | null;
          id: string;
          is_active: boolean;
          key: string;
          kind: Database["public"]["Enums"]["object_definition_kind"];
          plural_label: string;
          semantic_type: string | null;
          singular_label: string;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          description?: string;
          icon?: string | null;
          id?: string;
          is_active?: boolean;
          key: string;
          kind: Database["public"]["Enums"]["object_definition_kind"];
          plural_label: string;
          semantic_type?: string | null;
          singular_label: string;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          description?: string;
          icon?: string | null;
          id?: string;
          is_active?: boolean;
          key?: string;
          kind?: Database["public"]["Enums"]["object_definition_kind"];
          plural_label?: string;
          semantic_type?: string | null;
          singular_label?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "object_definitions_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      pages: {
        Row: {
          audience: Database["public"]["Enums"]["experience_audience"];
          business_id: string;
          created_at: string;
          id: string;
          is_active: boolean;
          key: string;
          layout_json: Json;
          slug: string;
          status: Database["public"]["Enums"]["experience_page_status"];
          title: string;
          updated_at: string;
        };
        Insert: {
          audience: Database["public"]["Enums"]["experience_audience"];
          business_id: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          key: string;
          layout_json: Json;
          slug: string;
          status?: Database["public"]["Enums"]["experience_page_status"];
          title: string;
          updated_at?: string;
        };
        Update: {
          audience?: Database["public"]["Enums"]["experience_audience"];
          business_id?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          key?: string;
          layout_json?: Json;
          slug?: string;
          status?: Database["public"]["Enums"]["experience_page_status"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pages_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      preorder_experience_locations: {
        Row: {
          business_id: string;
          created_at: string;
          id: string;
          is_active: boolean;
          location_id: string;
          preorder_experience_id: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          location_id: string;
          preorder_experience_id: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          location_id?: string;
          preorder_experience_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "preorder_experience_locations_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "preorder_experience_locations_tenant_experience_fkey";
            columns: ["business_id", "preorder_experience_id"];
            isOneToOne: false;
            referencedRelation: "preorder_experiences";
            referencedColumns: ["business_id", "id"];
          },
          {
            foreignKeyName: "preorder_experience_locations_tenant_location_fkey";
            columns: ["business_id", "location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["business_id", "id"];
          },
        ];
      };
      preorder_experiences: {
        Row: {
          business_id: string;
          config_json: Json;
          created_at: string;
          customer_object_definition_id: string;
          customer_places_order_relationship_definition_id: string;
          id: string;
          is_active: boolean;
          key: string;
          order_contains_item_relationship_definition_id: string;
          order_item_object_definition_id: string;
          order_object_definition_id: string;
          product_appears_in_item_relationship_definition_id: string;
          product_object_definition_id: string;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          config_json: Json;
          created_at?: string;
          customer_object_definition_id: string;
          customer_places_order_relationship_definition_id: string;
          id?: string;
          is_active?: boolean;
          key: string;
          order_contains_item_relationship_definition_id: string;
          order_item_object_definition_id: string;
          order_object_definition_id: string;
          product_appears_in_item_relationship_definition_id: string;
          product_object_definition_id: string;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          config_json?: Json;
          created_at?: string;
          customer_object_definition_id?: string;
          customer_places_order_relationship_definition_id?: string;
          id?: string;
          is_active?: boolean;
          key?: string;
          order_contains_item_relationship_definition_id?: string;
          order_item_object_definition_id?: string;
          order_object_definition_id?: string;
          product_appears_in_item_relationship_definition_id?: string;
          product_object_definition_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "preorder_experiences_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "preorder_experiences_tenant_customer_object_fkey";
            columns: ["business_id", "customer_object_definition_id"];
            isOneToOne: false;
            referencedRelation: "object_definitions";
            referencedColumns: ["business_id", "id"];
          },
          {
            foreignKeyName: "preorder_experiences_tenant_customer_order_relationship_fkey";
            columns: [
              "business_id",
              "customer_places_order_relationship_definition_id",
            ];
            isOneToOne: false;
            referencedRelation: "relationship_definitions";
            referencedColumns: ["business_id", "id"];
          },
          {
            foreignKeyName: "preorder_experiences_tenant_order_item_object_fkey";
            columns: ["business_id", "order_item_object_definition_id"];
            isOneToOne: false;
            referencedRelation: "object_definitions";
            referencedColumns: ["business_id", "id"];
          },
          {
            foreignKeyName: "preorder_experiences_tenant_order_item_relationship_fkey";
            columns: [
              "business_id",
              "order_contains_item_relationship_definition_id",
            ];
            isOneToOne: false;
            referencedRelation: "relationship_definitions";
            referencedColumns: ["business_id", "id"];
          },
          {
            foreignKeyName: "preorder_experiences_tenant_order_object_fkey";
            columns: ["business_id", "order_object_definition_id"];
            isOneToOne: false;
            referencedRelation: "object_definitions";
            referencedColumns: ["business_id", "id"];
          },
          {
            foreignKeyName: "preorder_experiences_tenant_product_item_relationship_fkey";
            columns: [
              "business_id",
              "product_appears_in_item_relationship_definition_id",
            ];
            isOneToOne: false;
            referencedRelation: "relationship_definitions";
            referencedColumns: ["business_id", "id"];
          },
          {
            foreignKeyName: "preorder_experiences_tenant_product_object_fkey";
            columns: ["business_id", "product_object_definition_id"];
            isOneToOne: false;
            referencedRelation: "object_definitions";
            referencedColumns: ["business_id", "id"];
          },
        ];
      };
      preorder_rate_limits: {
        Row: {
          attempt_count: number;
          business_id: string;
          id: string;
          preorder_experience_id: string;
          request_hash: string;
          updated_at: string;
          window_started_at: string;
        };
        Insert: {
          attempt_count?: number;
          business_id: string;
          id?: string;
          preorder_experience_id: string;
          request_hash: string;
          updated_at?: string;
          window_started_at: string;
        };
        Update: {
          attempt_count?: number;
          business_id?: string;
          id?: string;
          preorder_experience_id?: string;
          request_hash?: string;
          updated_at?: string;
          window_started_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "preorder_rate_limits_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "preorder_rate_limits_tenant_experience_fkey";
            columns: ["business_id", "preorder_experience_id"];
            isOneToOne: false;
            referencedRelation: "preorder_experiences";
            referencedColumns: ["business_id", "id"];
          },
        ];
      };
      preorder_slot_counters: {
        Row: {
          business_id: string;
          collection_at: string;
          created_at: string;
          id: string;
          location_id: string;
          preorder_experience_id: string;
          reservation_count: number;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          collection_at: string;
          created_at?: string;
          id?: string;
          location_id: string;
          preorder_experience_id: string;
          reservation_count?: number;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          collection_at?: string;
          created_at?: string;
          id?: string;
          location_id?: string;
          preorder_experience_id?: string;
          reservation_count?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "preorder_slot_counters_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "preorder_slot_counters_tenant_experience_fkey";
            columns: ["business_id", "preorder_experience_id"];
            isOneToOne: false;
            referencedRelation: "preorder_experiences";
            referencedColumns: ["business_id", "id"];
          },
          {
            foreignKeyName: "preorder_slot_counters_tenant_location_fkey";
            columns: ["business_id", "location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["business_id", "id"];
          },
        ];
      };
      preorder_submissions: {
        Row: {
          business_id: string;
          confirmation_json: Json | null;
          created_at: string;
          email_attempted_at: string | null;
          email_error: string | null;
          email_status: Database["public"]["Enums"]["preorder_email_status"];
          id: string;
          idempotency_token: string;
          order_record_id: string | null;
          preorder_experience_id: string;
          public_reference: string;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          confirmation_json?: Json | null;
          created_at?: string;
          email_attempted_at?: string | null;
          email_error?: string | null;
          email_status?: Database["public"]["Enums"]["preorder_email_status"];
          id?: string;
          idempotency_token: string;
          order_record_id?: string | null;
          preorder_experience_id: string;
          public_reference?: string;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          confirmation_json?: Json | null;
          created_at?: string;
          email_attempted_at?: string | null;
          email_error?: string | null;
          email_status?: Database["public"]["Enums"]["preorder_email_status"];
          id?: string;
          idempotency_token?: string;
          order_record_id?: string | null;
          preorder_experience_id?: string;
          public_reference?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "preorder_submissions_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "preorder_submissions_tenant_experience_fkey";
            columns: ["business_id", "preorder_experience_id"];
            isOneToOne: false;
            referencedRelation: "preorder_experiences";
            referencedColumns: ["business_id", "id"];
          },
          {
            foreignKeyName: "preorder_submissions_tenant_order_record_fkey";
            columns: ["business_id", "order_record_id"];
            isOneToOne: false;
            referencedRelation: "records";
            referencedColumns: ["business_id", "id"];
          },
        ];
      };
      record_location_links: {
        Row: {
          business_id: string;
          created_at: string;
          id: string;
          location_id: string;
          record_id: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          id?: string;
          location_id: string;
          record_id: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          id?: string;
          location_id?: string;
          record_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "record_location_links_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "record_location_links_tenant_location_fkey";
            columns: ["business_id", "location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["business_id", "id"];
          },
          {
            foreignKeyName: "record_location_links_tenant_record_fkey";
            columns: ["business_id", "record_id"];
            isOneToOne: false;
            referencedRelation: "records";
            referencedColumns: ["business_id", "id"];
          },
        ];
      };
      record_relationships: {
        Row: {
          business_id: string;
          created_at: string;
          id: string;
          relationship_definition_id: string;
          source_record_id: string;
          target_record_id: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          id?: string;
          relationship_definition_id: string;
          source_record_id: string;
          target_record_id: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          id?: string;
          relationship_definition_id?: string;
          source_record_id?: string;
          target_record_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "record_relationships_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "record_relationships_tenant_definition_fkey";
            columns: ["business_id", "relationship_definition_id"];
            isOneToOne: false;
            referencedRelation: "relationship_definitions";
            referencedColumns: ["business_id", "id"];
          },
          {
            foreignKeyName: "record_relationships_tenant_source_record_fkey";
            columns: ["business_id", "source_record_id"];
            isOneToOne: false;
            referencedRelation: "records";
            referencedColumns: ["business_id", "id"];
          },
          {
            foreignKeyName: "record_relationships_tenant_target_record_fkey";
            columns: ["business_id", "target_record_id"];
            isOneToOne: false;
            referencedRelation: "records";
            referencedColumns: ["business_id", "id"];
          },
        ];
      };
      records: {
        Row: {
          business_id: string;
          created_at: string;
          created_by: string | null;
          data_json: Json;
          id: string;
          object_definition_id: string;
          record_status: Database["public"]["Enums"]["graph_record_status"];
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          data_json?: Json;
          id?: string;
          object_definition_id: string;
          record_status?: Database["public"]["Enums"]["graph_record_status"];
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          data_json?: Json;
          id?: string;
          object_definition_id?: string;
          record_status?: Database["public"]["Enums"]["graph_record_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "records_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "records_tenant_object_fkey";
            columns: ["business_id", "object_definition_id"];
            isOneToOne: false;
            referencedRelation: "object_definitions";
            referencedColumns: ["business_id", "id"];
          },
        ];
      };
      relationship_definitions: {
        Row: {
          business_id: string;
          cardinality: Database["public"]["Enums"]["relationship_cardinality"];
          created_at: string;
          id: string;
          is_active: boolean;
          is_required: boolean;
          key: string;
          source_label: string;
          source_object_definition_id: string;
          target_label: string;
          target_object_definition_id: string;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          cardinality: Database["public"]["Enums"]["relationship_cardinality"];
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_required?: boolean;
          key: string;
          source_label: string;
          source_object_definition_id: string;
          target_label: string;
          target_object_definition_id: string;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          cardinality?: Database["public"]["Enums"]["relationship_cardinality"];
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_required?: boolean;
          key?: string;
          source_label?: string;
          source_object_definition_id?: string;
          target_label?: string;
          target_object_definition_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "relationship_definitions_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "relationship_definitions_tenant_source_object_fkey";
            columns: ["business_id", "source_object_definition_id"];
            isOneToOne: false;
            referencedRelation: "object_definitions";
            referencedColumns: ["business_id", "id"];
          },
          {
            foreignKeyName: "relationship_definitions_tenant_target_object_fkey";
            columns: ["business_id", "target_object_definition_id"];
            isOneToOne: false;
            referencedRelation: "object_definitions";
            referencedColumns: ["business_id", "id"];
          },
        ];
      };
      views: {
        Row: {
          audience: Database["public"]["Enums"]["experience_audience"];
          business_id: string;
          config_json: Json;
          created_at: string;
          id: string;
          is_active: boolean;
          key: string;
          name: string;
          object_definition_id: string;
          updated_at: string;
          view_type: Database["public"]["Enums"]["experience_view_type"];
        };
        Insert: {
          audience?: Database["public"]["Enums"]["experience_audience"];
          business_id: string;
          config_json: Json;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          key: string;
          name: string;
          object_definition_id: string;
          updated_at?: string;
          view_type: Database["public"]["Enums"]["experience_view_type"];
        };
        Update: {
          audience?: Database["public"]["Enums"]["experience_audience"];
          business_id?: string;
          config_json?: Json;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          key?: string;
          name?: string;
          object_definition_id?: string;
          updated_at?: string;
          view_type?: Database["public"]["Enums"]["experience_view_type"];
        };
        Relationships: [
          {
            foreignKeyName: "views_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "views_tenant_object_fkey";
            columns: ["business_id", "object_definition_id"];
            isOneToOne: false;
            referencedRelation: "object_definitions";
            referencedColumns: ["business_id", "id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      abandon_configuration_change_set: {
        Args: {
          expected_actor_id: string;
          expected_business_id: string;
          requested_change_set_id: string;
        };
        Returns: {
          applied_at: string | null;
          applied_by: string | null;
          applied_version_id: string | null;
          base_head_revision: number;
          base_version_id: string;
          business_id: string;
          candidate_checksum: string;
          candidate_snapshot_json: Json;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          description: string | null;
          display_context_json: Json;
          id: string;
          id_allocations_json: Json;
          kind: Database["public"]["Enums"]["configuration_change_kind"];
          operations_json: Json;
          operations_schema_version: number;
          requested_by: string;
          rollback_target_version_id: string | null;
          semantic_diff_json: Json;
          status: Database["public"]["Enums"]["configuration_change_status"];
          title: string;
          updated_at: string;
          validated_at: string | null;
          validated_by: string | null;
          validation_result_json: Json | null;
        };
        SetofOptions: {
          from: "*";
          to: "configuration_change_sets";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      apply_configuration_change: {
        Args: {
          expected_actor_id: string;
          expected_business_id: string;
          requested_change_set_id: string;
        };
        Returns: {
          applied_at: string | null;
          applied_by: string | null;
          applied_version_id: string | null;
          base_head_revision: number;
          base_version_id: string;
          business_id: string;
          candidate_checksum: string;
          candidate_snapshot_json: Json;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          description: string | null;
          display_context_json: Json;
          id: string;
          id_allocations_json: Json;
          kind: Database["public"]["Enums"]["configuration_change_kind"];
          operations_json: Json;
          operations_schema_version: number;
          requested_by: string;
          rollback_target_version_id: string | null;
          semantic_diff_json: Json;
          status: Database["public"]["Enums"]["configuration_change_status"];
          title: string;
          updated_at: string;
          validated_at: string | null;
          validated_by: string | null;
          validation_result_json: Json | null;
        };
        SetofOptions: {
          from: "*";
          to: "configuration_change_sets";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      apply_direct_configuration_change: {
        Args: {
          expected_actor_id: string;
          expected_base_version_id: string;
          expected_business_id: string;
          expected_head_revision: number;
          requested_action_kind: string;
          requested_operations: Json;
        };
        Returns: {
          applied_at: string | null;
          applied_by: string | null;
          applied_version_id: string | null;
          base_head_revision: number;
          base_version_id: string;
          business_id: string;
          candidate_checksum: string;
          candidate_snapshot_json: Json;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          description: string | null;
          display_context_json: Json;
          id: string;
          id_allocations_json: Json;
          kind: Database["public"]["Enums"]["configuration_change_kind"];
          operations_json: Json;
          operations_schema_version: number;
          requested_by: string;
          rollback_target_version_id: string | null;
          semantic_diff_json: Json;
          status: Database["public"]["Enums"]["configuration_change_status"];
          title: string;
          updated_at: string;
          validated_at: string | null;
          validated_by: string | null;
          validation_result_json: Json | null;
        };
        SetofOptions: {
          from: "*";
          to: "configuration_change_sets";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      apply_direct_page_configuration_change: {
        Args: {
          expected_actor_id: string;
          expected_base_version_id: string;
          expected_business_id: string;
          expected_head_revision: number;
          requested_action_kind: string;
          requested_operations: Json;
        };
        Returns: {
          applied_at: string | null;
          applied_by: string | null;
          applied_version_id: string | null;
          base_head_revision: number;
          base_version_id: string;
          business_id: string;
          candidate_checksum: string;
          candidate_snapshot_json: Json;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          description: string | null;
          display_context_json: Json;
          id: string;
          id_allocations_json: Json;
          kind: Database["public"]["Enums"]["configuration_change_kind"];
          operations_json: Json;
          operations_schema_version: number;
          requested_by: string;
          rollback_target_version_id: string | null;
          semantic_diff_json: Json;
          status: Database["public"]["Enums"]["configuration_change_status"];
          title: string;
          updated_at: string;
          validated_at: string | null;
          validated_by: string | null;
          validation_result_json: Json | null;
        };
        SetofOptions: {
          from: "*";
          to: "configuration_change_sets";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      apply_direct_table_record_batch: {
        Args: {
          expected_business_id: string;
          requested_rows: Json;
          requested_view_key: string;
        };
        Returns: Json;
      };
      apply_internal_workspace_configuration_change: {
        Args: {
          expected_actor_id: string;
          expected_base_version_id: string;
          expected_business_id: string;
          expected_head_revision: number;
          requested_action_kind: string;
          requested_operations: Json;
        };
        Returns: {
          applied_at: string | null;
          applied_by: string | null;
          applied_version_id: string | null;
          base_head_revision: number;
          base_version_id: string;
          business_id: string;
          candidate_checksum: string;
          candidate_snapshot_json: Json;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          description: string | null;
          display_context_json: Json;
          id: string;
          id_allocations_json: Json;
          kind: Database["public"]["Enums"]["configuration_change_kind"];
          operations_json: Json;
          operations_schema_version: number;
          requested_by: string;
          rollback_target_version_id: string | null;
          semantic_diff_json: Json;
          status: Database["public"]["Enums"]["configuration_change_status"];
          title: string;
          updated_at: string;
          validated_at: string | null;
          validated_by: string | null;
          validation_result_json: Json | null;
        };
        SetofOptions: {
          from: "*";
          to: "configuration_change_sets";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      apply_lenni_direct_configuration_change: {
        Args: {
          expected_actor_id: string;
          expected_base_version_id: string;
          expected_business_id: string;
          expected_head_revision: number;
          requested_action_kind: string;
          requested_operations: Json;
        };
        Returns: {
          applied_at: string | null;
          applied_by: string | null;
          applied_version_id: string | null;
          base_head_revision: number;
          base_version_id: string;
          business_id: string;
          candidate_checksum: string;
          candidate_snapshot_json: Json;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          description: string | null;
          display_context_json: Json;
          id: string;
          id_allocations_json: Json;
          kind: Database["public"]["Enums"]["configuration_change_kind"];
          operations_json: Json;
          operations_schema_version: number;
          requested_by: string;
          rollback_target_version_id: string | null;
          semantic_diff_json: Json;
          status: Database["public"]["Enums"]["configuration_change_status"];
          title: string;
          updated_at: string;
          validated_at: string | null;
          validated_by: string | null;
          validation_result_json: Json | null;
        };
        SetofOptions: {
          from: "*";
          to: "configuration_change_sets";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      archive_graph_record: {
        Args: { expected_business_id: string; target_record_id: string };
        Returns: {
          business_id: string;
          created_at: string;
          created_by: string | null;
          data_json: Json;
          id: string;
          object_definition_id: string;
          record_status: Database["public"]["Enums"]["graph_record_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "records";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      claim_anonymous_build_session: {
        Args: {
          requested_business_name: string;
          requested_session_token: string;
          requested_timezone: string;
        };
        Returns: {
          business_type: string;
          created_at: string;
          id: string;
          name: string;
          settings_json: Json;
          slug: string;
          timezone: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "businesses";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      claim_preorder_confirmation_email: {
        Args: {
          requested_business_slug: string;
          requested_idempotency_token: string;
          requested_preorder_key: string;
        };
        Returns: Json;
      };
      complete_preorder_confirmation_email: {
        Args: {
          delivery_error?: string;
          delivery_succeeded: boolean;
          requested_business_slug: string;
          requested_idempotency_token: string;
          requested_preorder_key: string;
        };
        Returns: boolean;
      };
      create_business: {
        Args: {
          business_name: string;
          requested_business_type?: string;
          requested_timezone?: string;
        };
        Returns: {
          business_type: string;
          created_at: string;
          id: string;
          name: string;
          settings_json: Json;
          slug: string;
          timezone: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "businesses";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_confirmed_graph_record: {
        Args: {
          expected_actor_id: string;
          expected_base_version_id: string;
          expected_business_id: string;
          expected_head_revision: number;
          expected_object_schema_digest: string;
          expected_record_state_digest: string;
          requested_data: Json;
          target_object_key: string;
        };
        Returns: {
          business_id: string;
          created_at: string;
          created_by: string | null;
          data_json: Json;
          id: string;
          object_definition_id: string;
          record_status: Database["public"]["Enums"]["graph_record_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "records";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_graph_record: {
        Args: {
          expected_business_id: string;
          requested_data?: Json;
          requested_record_status?: Database["public"]["Enums"]["graph_record_status"];
          target_object_definition_id: string;
        };
        Returns: {
          business_id: string;
          created_at: string;
          created_by: string | null;
          data_json: Json;
          id: string;
          object_definition_id: string;
          record_status: Database["public"]["Enums"]["graph_record_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "records";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_graph_relationship: {
        Args: {
          expected_business_id: string;
          target_relationship_definition_id: string;
          target_source_record_id: string;
          target_target_record_id: string;
        };
        Returns: {
          business_id: string;
          created_at: string;
          id: string;
          relationship_definition_id: string;
          source_record_id: string;
          target_record_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "record_relationships";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_location: {
        Args: {
          expected_actor_id: string;
          expected_business_id: string;
          expected_business_timezone: string;
          expected_location_state_digest: string;
          location_name: string;
          requested_timezone: string;
        };
        Returns: {
          address_json: Json;
          business_id: string;
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          opening_hours_json: Json;
          settings_json: Json;
          slug: string;
          timezone: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "locations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_preorder_experience: {
        Args: {
          expected_business_id: string;
          requested_config: Json;
          requested_customer_object_definition_id: string;
          requested_customer_places_order_relationship_definition_id: string;
          requested_is_active?: boolean;
          requested_key: string;
          requested_location_ids: string[];
          requested_order_contains_item_relationship_definition_id: string;
          requested_order_item_object_definition_id: string;
          requested_order_object_definition_id: string;
          requested_product_appears_in_item_relationship_definition_id: string;
          requested_product_object_definition_id: string;
        };
        Returns: {
          business_id: string;
          config_json: Json;
          created_at: string;
          customer_object_definition_id: string;
          customer_places_order_relationship_definition_id: string;
          id: string;
          is_active: boolean;
          key: string;
          order_contains_item_relationship_definition_id: string;
          order_item_object_definition_id: string;
          order_object_definition_id: string;
          product_appears_in_item_relationship_definition_id: string;
          product_object_definition_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "preorder_experiences";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_record_location_link: {
        Args: {
          expected_business_id: string;
          target_location_id: string;
          target_record_id: string;
        };
        Returns: {
          business_id: string;
          created_at: string;
          id: string;
          location_id: string;
          record_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "record_location_links";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      get_business_ai_settings: {
        Args: { expected_actor_id: string; expected_business_id: string };
        Returns: {
          business_id: string;
          created_at: string;
          daily_cost_limit_microusd: number;
          daily_input_token_limit: number;
          daily_output_token_limit: number;
          daily_request_limit: number;
          is_enabled: boolean;
          updated_at: string;
          updated_by: string;
        }[];
      };
      get_business_ai_usage_summary: {
        Args: { expected_actor_id: string; expected_business_id: string };
        Returns: {
          cost_microusd: number;
          input_tokens: number;
          output_tokens: number;
          request_count: number;
          usage_day: string;
        }[];
      };
      get_configuration_change_set: {
        Args: { expected_business_id: string; requested_change_set_id: string };
        Returns: {
          applied_at: string | null;
          applied_by: string | null;
          applied_version_id: string | null;
          base_head_revision: number;
          base_version_id: string;
          business_id: string;
          candidate_checksum: string;
          candidate_snapshot_json: Json;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          description: string | null;
          display_context_json: Json;
          id: string;
          id_allocations_json: Json;
          kind: Database["public"]["Enums"]["configuration_change_kind"];
          operations_json: Json;
          operations_schema_version: number;
          requested_by: string;
          rollback_target_version_id: string | null;
          semantic_diff_json: Json;
          status: Database["public"]["Enums"]["configuration_change_status"];
          title: string;
          updated_at: string;
          validated_at: string | null;
          validated_by: string | null;
          validation_result_json: Json | null;
        };
        SetofOptions: {
          from: "*";
          to: "configuration_change_sets";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      get_configuration_version: {
        Args: { expected_business_id: string; requested_version_id: string };
        Returns: {
          business_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          kind: Database["public"]["Enums"]["configuration_version_kind"];
          parent_version_id: string | null;
          restored_from_version_id: string | null;
          snapshot_checksum: string;
          snapshot_json: Json;
          snapshot_schema_version: number;
          source_change_set_id: string | null;
          version_number: number;
        };
        SetofOptions: {
          from: "*";
          to: "configuration_versions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      get_confirmed_graph_record_creation_state: {
        Args: {
          expected_actor_id: string;
          expected_business_id: string;
          target_object_key: string;
        };
        Returns: {
          actor_id: string;
          base_version_id: string;
          business_id: string;
          eligibility: Json;
          fields: Json;
          head_revision: number;
          internal_views: Json;
          is_active: boolean;
          object_definition_id: string;
          object_key: string;
          object_schema_digest: string;
          plural_label: string;
          record_state_digest: string;
          schema_version: number;
          singular_label: string;
        }[];
      };
      get_confirmed_graph_record_update_state: {
        Args: {
          expected_actor_id: string;
          expected_business_id: string;
          requested_selector: Json;
          requested_update_field_keys: string[];
          target_object_key: string;
        };
        Returns: Json;
      };
      get_confirmed_record_location_link_state: {
        Args: {
          expected_actor_id: string;
          expected_business_id: string;
          requested_action: string;
          requested_selector: Json;
          target_location_id: string;
          target_object_key: string;
        };
        Returns: Json;
      };
      get_location_creation_state: {
        Args: { expected_actor_id: string; expected_business_id: string };
        Returns: {
          actor_id: string;
          business_id: string;
          business_timezone: string;
          location_state_digest: string;
          locations: Json;
          schema_version: number;
        }[];
      };
      list_business_ai_execution_runs: {
        Args: { expected_actor_id: string; expected_business_id: string };
        Returns: {
          actor_id: string;
          actual_cost_microusd: number;
          actual_input_tokens: number;
          actual_output_tokens: number;
          business_id: string;
          charged_cost_microusd: number;
          charged_input_tokens: number;
          charged_output_tokens: number;
          id: string;
          model_key: string;
          outcome_code: string;
          policy_key: string;
          provider_attempt_count: number;
          provider_invocation_started: boolean;
          provider_key: string;
          purpose_label: string;
          reserved_at: string;
          reserved_cost_microusd: number;
          reserved_input_tokens: number;
          reserved_output_tokens: number;
          reserved_request_count: number;
          settled_at: string;
          status: Database["public"]["Enums"]["ai_execution_status"];
          task_key: string;
          task_version: number;
          usage_complete: boolean;
          usage_day: string;
          usage_overrun: boolean;
        }[];
      };
      list_configuration_change_sets: {
        Args: { expected_business_id: string };
        Returns: {
          applied_at: string | null;
          applied_by: string | null;
          applied_version_id: string | null;
          base_head_revision: number;
          base_version_id: string;
          business_id: string;
          candidate_checksum: string;
          candidate_snapshot_json: Json;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          description: string | null;
          display_context_json: Json;
          id: string;
          id_allocations_json: Json;
          kind: Database["public"]["Enums"]["configuration_change_kind"];
          operations_json: Json;
          operations_schema_version: number;
          requested_by: string;
          rollback_target_version_id: string | null;
          semantic_diff_json: Json;
          status: Database["public"]["Enums"]["configuration_change_status"];
          title: string;
          updated_at: string;
          validated_at: string | null;
          validated_by: string | null;
          validation_result_json: Json | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "configuration_change_sets";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      list_configuration_versions: {
        Args: { expected_business_id: string };
        Returns: {
          business_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          kind: Database["public"]["Enums"]["configuration_version_kind"];
          parent_version_id: string | null;
          restored_from_version_id: string | null;
          snapshot_checksum: string;
          snapshot_json: Json;
          snapshot_schema_version: number;
          source_change_set_id: string | null;
          version_number: number;
        }[];
        SetofOptions: {
          from: "*";
          to: "configuration_versions";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      load_configuration_preview: {
        Args: {
          expected_actor_id: string;
          expected_business_id: string;
          requested_change_set_id: string;
        };
        Returns: {
          applied_at: string | null;
          applied_by: string | null;
          applied_version_id: string | null;
          base_head_revision: number;
          base_version_id: string;
          business_id: string;
          candidate_checksum: string;
          candidate_snapshot_json: Json;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          description: string | null;
          display_context_json: Json;
          id: string;
          id_allocations_json: Json;
          kind: Database["public"]["Enums"]["configuration_change_kind"];
          operations_json: Json;
          operations_schema_version: number;
          requested_by: string;
          rollback_target_version_id: string | null;
          semantic_diff_json: Json;
          status: Database["public"]["Enums"]["configuration_change_status"];
          title: string;
          updated_at: string;
          validated_at: string | null;
          validated_by: string | null;
          validation_result_json: Json | null;
        };
        SetofOptions: {
          from: "*";
          to: "configuration_change_sets";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      prepare_configuration_rollback: {
        Args: {
          expected_active_source_version_id: string;
          expected_actor_id: string;
          expected_business_id: string;
          expected_head_revision: number;
          requested_description: string;
          requested_target_version_id: string;
          requested_title: string;
        };
        Returns: {
          applied_at: string | null;
          applied_by: string | null;
          applied_version_id: string | null;
          base_head_revision: number;
          base_version_id: string;
          business_id: string;
          candidate_checksum: string;
          candidate_snapshot_json: Json;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          description: string | null;
          display_context_json: Json;
          id: string;
          id_allocations_json: Json;
          kind: Database["public"]["Enums"]["configuration_change_kind"];
          operations_json: Json;
          operations_schema_version: number;
          requested_by: string;
          rollback_target_version_id: string | null;
          semantic_diff_json: Json;
          status: Database["public"]["Enums"]["configuration_change_status"];
          title: string;
          updated_at: string;
          validated_at: string | null;
          validated_by: string | null;
          validation_result_json: Json | null;
        };
        SetofOptions: {
          from: "*";
          to: "configuration_change_sets";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      propose_configuration_change: {
        Args: {
          expected_actor_id: string;
          expected_base_version_id: string;
          expected_business_id: string;
          expected_head_revision: number;
          requested_description: string;
          requested_operations: Json;
          requested_title: string;
        };
        Returns: {
          applied_at: string | null;
          applied_by: string | null;
          applied_version_id: string | null;
          base_head_revision: number;
          base_version_id: string;
          business_id: string;
          candidate_checksum: string;
          candidate_snapshot_json: Json;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          description: string | null;
          display_context_json: Json;
          id: string;
          id_allocations_json: Json;
          kind: Database["public"]["Enums"]["configuration_change_kind"];
          operations_json: Json;
          operations_schema_version: number;
          requested_by: string;
          rollback_target_version_id: string | null;
          semantic_diff_json: Json;
          status: Database["public"]["Enums"]["configuration_change_status"];
          title: string;
          updated_at: string;
          validated_at: string | null;
          validated_by: string | null;
          validation_result_json: Json | null;
        };
        SetofOptions: {
          from: "*";
          to: "configuration_change_sets";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      query_view_records: {
        Args: {
          expected_business_id: string;
          requested_limit?: number;
          requested_offset?: number;
          requested_view_key: string;
        };
        Returns: Json;
      };
      remove_graph_relationship: {
        Args: {
          expected_business_id: string;
          target_record_relationship_id: string;
        };
        Returns: boolean;
      };
      remove_record_location_link: {
        Args: {
          expected_business_id: string;
          target_record_location_link_id: string;
        };
        Returns: boolean;
      };
      reserve_anonymous_build_attempt: {
        Args: {
          requested_category_value: string;
          requested_expires_at: string;
          requested_rate_key: string;
          requested_session_token_hash: string;
        };
        Returns: Json;
      };
      reserve_business_ai_execution: {
        Args: {
          expected_actor_id: string;
          expected_business_id: string;
          requested_execution_id: string;
          requested_input_microusd_per_million: number;
          requested_model_key: string;
          requested_output_microusd_per_million: number;
          requested_policy_key: string;
          requested_provider_key: string;
          requested_purpose_label: string;
          requested_reserved_input_tokens: number;
          requested_reserved_output_tokens: number;
          requested_task_key: string;
          requested_task_version: number;
        };
        Returns: {
          business_id: string;
          id: string;
          reserved_at: string;
          reserved_cost_microusd: number;
          reserved_input_tokens: number;
          reserved_output_tokens: number;
          reserved_request_count: number;
          status: Database["public"]["Enums"]["ai_execution_status"];
          usage_day: string;
        }[];
      };
      resolve_configuration_preview_preorder: {
        Args: {
          expected_actor_id: string;
          expected_business_id: string;
          requested_change_set_id: string;
          requested_page_key: string;
          requested_preorder_key: string;
        };
        Returns: Json;
      };
      resolve_public_page: {
        Args: { requested_business_slug: string; requested_page_slug: string };
        Returns: Json;
      };
      resolve_public_preorder: {
        Args: {
          requested_business_slug: string;
          requested_page_slug: string;
          requested_preorder_key: string;
        };
        Returns: Json;
      };
      search_view_connection_targets: {
        Args: {
          expected_business_id: string;
          requested_direction: string;
          requested_limit?: number;
          requested_offset?: number;
          requested_relationship_key: string;
          requested_search?: string;
          requested_view_key: string;
        };
        Returns: Json;
      };
      set_preorder_experience_locations: {
        Args: {
          expected_business_id: string;
          requested_location_ids: string[];
          target_preorder_experience_id: string;
        };
        Returns: number;
      };
      set_record_connection_values: {
        Args: {
          expected_business_id: string;
          requested_direction: string;
          requested_record_id: string;
          requested_relationship_key: string;
          requested_target_record_ids: string[];
          requested_view_key: string;
        };
        Returns: Json;
      };
      settle_business_ai_execution: {
        Args: {
          expected_business_id: string;
          requested_actual_input_tokens: number;
          requested_actual_output_tokens: number;
          requested_execution_id: string;
          requested_outcome_code: string;
          requested_provider_attempt_count: number;
          requested_provider_invocation_started: boolean;
          requested_status: Database["public"]["Enums"]["ai_execution_status"];
          requested_usage_complete: boolean;
        };
        Returns: {
          actual_cost_microusd: number;
          actual_input_tokens: number;
          actual_output_tokens: number;
          business_id: string;
          charged_cost_microusd: number;
          charged_input_tokens: number;
          charged_output_tokens: number;
          id: string;
          outcome_code: string;
          provider_attempt_count: number;
          provider_invocation_started: boolean;
          settled_at: string;
          status: Database["public"]["Enums"]["ai_execution_status"];
          usage_complete: boolean;
          usage_overrun: boolean;
        }[];
      };
      submit_public_preorder: {
        Args: {
          requested_business_slug: string;
          requested_page_slug: string;
          requested_preorder_key: string;
          requested_request_hash: string;
          submission: Json;
        };
        Returns: Json;
      };
      undo_direct_configuration_change: {
        Args: {
          expected_active_source_version_id: string;
          expected_actor_id: string;
          expected_business_id: string;
          expected_head_revision: number;
        };
        Returns: {
          applied_at: string | null;
          applied_by: string | null;
          applied_version_id: string | null;
          base_head_revision: number;
          base_version_id: string;
          business_id: string;
          candidate_checksum: string;
          candidate_snapshot_json: Json;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          description: string | null;
          display_context_json: Json;
          id: string;
          id_allocations_json: Json;
          kind: Database["public"]["Enums"]["configuration_change_kind"];
          operations_json: Json;
          operations_schema_version: number;
          requested_by: string;
          rollback_target_version_id: string | null;
          semantic_diff_json: Json;
          status: Database["public"]["Enums"]["configuration_change_status"];
          title: string;
          updated_at: string;
          validated_at: string | null;
          validated_by: string | null;
          validation_result_json: Json | null;
        };
        SetofOptions: {
          from: "*";
          to: "configuration_change_sets";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_business_ai_settings: {
        Args: {
          expected_actor_id: string;
          expected_business_id: string;
          requested_daily_cost_limit_microusd: number;
          requested_daily_input_token_limit: number;
          requested_daily_output_token_limit: number;
          requested_daily_request_limit: number;
          requested_is_enabled: boolean;
        };
        Returns: {
          business_id: string;
          created_at: string;
          daily_cost_limit_microusd: number;
          daily_input_token_limit: number;
          daily_output_token_limit: number;
          daily_request_limit: number;
          is_enabled: boolean;
          updated_at: string;
          updated_by: string;
        }[];
      };
      update_confirmed_graph_record: {
        Args: {
          expected_actor_id: string;
          expected_base_version_id: string;
          expected_business_id: string;
          expected_head_revision: number;
          expected_object_definition_id: string;
          expected_record_updated_at: string;
          requested_data_patch: Json;
          target_object_key: string;
          target_record_id: string;
        };
        Returns: {
          business_id: string;
          created_at: string;
          created_by: string | null;
          data_json: Json;
          id: string;
          object_definition_id: string;
          record_status: Database["public"]["Enums"]["graph_record_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "records";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_graph_record: {
        Args: {
          data_patch?: Json;
          expected_business_id: string;
          requested_record_status?: Database["public"]["Enums"]["graph_record_status"];
          target_record_id: string;
        };
        Returns: {
          business_id: string;
          created_at: string;
          created_by: string | null;
          data_json: Json;
          id: string;
          object_definition_id: string;
          record_status: Database["public"]["Enums"]["graph_record_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "records";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      validate_configuration_change: {
        Args: {
          expected_actor_id: string;
          expected_business_id: string;
          requested_change_set_id: string;
        };
        Returns: {
          applied_at: string | null;
          applied_by: string | null;
          applied_version_id: string | null;
          base_head_revision: number;
          base_version_id: string;
          business_id: string;
          candidate_checksum: string;
          candidate_snapshot_json: Json;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          description: string | null;
          display_context_json: Json;
          id: string;
          id_allocations_json: Json;
          kind: Database["public"]["Enums"]["configuration_change_kind"];
          operations_json: Json;
          operations_schema_version: number;
          requested_by: string;
          rollback_target_version_id: string | null;
          semantic_diff_json: Json;
          status: Database["public"]["Enums"]["configuration_change_status"];
          title: string;
          updated_at: string;
          validated_at: string | null;
          validated_by: string | null;
          validation_result_json: Json | null;
        };
        SetofOptions: {
          from: "*";
          to: "configuration_change_sets";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      ai_execution_status:
        "reserved" | "succeeded" | "failed" | "cancelled" | "expired";
      business_role: "owner" | "admin" | "staff";
      configuration_change_kind: "change" | "rollback";
      configuration_change_status:
        | "proposed"
        | "validated"
        | "applied"
        | "rejected"
        | "conflicted"
        | "abandoned";
      configuration_version_kind: "baseline" | "change" | "rollback";
      experience_audience: "internal" | "public";
      experience_form_mode: "create" | "edit";
      experience_page_status: "draft" | "published";
      experience_view_type: "table" | "list" | "cards" | "detail";
      graph_field_type:
        | "short_text"
        | "long_text"
        | "number"
        | "currency"
        | "boolean"
        | "date"
        | "datetime"
        | "email"
        | "phone"
        | "url"
        | "select"
        | "multi_select"
        | "file"
        | "status";
      graph_record_status: "active" | "archived";
      object_definition_kind: "template" | "custom";
      preorder_email_status: "pending" | "sending" | "delivered" | "failed";
      relationship_cardinality: "one_to_one" | "one_to_many" | "many_to_many";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      ai_execution_status: [
        "reserved",
        "succeeded",
        "failed",
        "cancelled",
        "expired",
      ],
      business_role: ["owner", "admin", "staff"],
      configuration_change_kind: ["change", "rollback"],
      configuration_change_status: [
        "proposed",
        "validated",
        "applied",
        "rejected",
        "conflicted",
        "abandoned",
      ],
      configuration_version_kind: ["baseline", "change", "rollback"],
      experience_audience: ["internal", "public"],
      experience_form_mode: ["create", "edit"],
      experience_page_status: ["draft", "published"],
      experience_view_type: ["table", "list", "cards", "detail"],
      graph_field_type: [
        "short_text",
        "long_text",
        "number",
        "currency",
        "boolean",
        "date",
        "datetime",
        "email",
        "phone",
        "url",
        "select",
        "multi_select",
        "file",
        "status",
      ],
      graph_record_status: ["active", "archived"],
      object_definition_kind: ["template", "custom"],
      preorder_email_status: ["pending", "sending", "delivered", "failed"],
      relationship_cardinality: ["one_to_one", "one_to_many", "many_to_many"],
    },
  },
} as const;
