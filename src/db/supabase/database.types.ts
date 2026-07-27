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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      archive_graph_record: {
        Args: { target_record_id: string };
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
      create_graph_record: {
        Args: {
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
          location_name: string;
          requested_timezone?: string;
          target_business_id: string;
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
      remove_graph_relationship: {
        Args: { target_record_relationship_id: string };
        Returns: boolean;
      };
      update_graph_record: {
        Args: {
          data_patch?: Json;
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
    };
    Enums: {
      business_role: "owner" | "admin" | "staff";
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
      business_role: ["owner", "admin", "staff"],
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
      relationship_cardinality: ["one_to_one", "one_to_many", "many_to_many"],
    },
  },
} as const;
