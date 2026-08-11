import type { Json } from "../../src/db/supabase/database.types";

export interface InternalWorkspaceProofFieldFixture {
  label: string;
  columnType:
    | "boolean"
    | "currency"
    | "date"
    | "email"
    | "number"
    | "select"
    | "short_text"
    | "status";
  options?: readonly string[];
  currency?: string;
}

export interface InternalWorkspaceProofTableFixture {
  key: string;
  title: string;
  fields?: readonly InternalWorkspaceProofFieldFixture[];
}

export interface InternalWorkspaceProofConnectionFixture {
  sourceTableKey: string;
  targetTableKey: string;
  label: string;
  currentMultiplicity: "one" | "several";
  targetMultiplicity: "one" | "several";
}

export interface InternalWorkspaceProofRecordFixture {
  tableKey: string;
  label: string;
  fields?: Readonly<Record<string, Json>>;
}

export interface InternalWorkspaceProofLinkFixture {
  sourceTableKey: string;
  targetTableKey: string;
  connectionLabel: string;
  sourceRecordLabel: string;
  targetRecordLabels: readonly string[];
}

export interface InternalWorkspaceProofQueryFixture {
  tableKey: string;
  name: string;
  filter?: {
    fieldLabel: string;
    operator: "is" | "on_or_after";
    value: Json;
  };
  sort?: {
    fieldLabel: string;
    direction: "ascending" | "descending";
  };
  groupFieldLabel?: string;
}

export interface InternalWorkspaceProofFixture {
  concept: string;
  businessName: string;
  objectKey: string;
  connectedObjectKey: string;
  primaryField: string;
  tables: readonly InternalWorkspaceProofTableFixture[];
  connections: readonly InternalWorkspaceProofConnectionFixture[];
  records: readonly InternalWorkspaceProofRecordFixture[];
  links: readonly InternalWorkspaceProofLinkFixture[];
  queries: readonly InternalWorkspaceProofQueryFixture[];
}

export const internalWorkspaceProofFixtures: readonly InternalWorkspaceProofFixture[] =
  [
    {
      concept: "Milk round",
      businessName: "Proof — Milk round",
      objectKey: "milk_round",
      connectedObjectKey: "customer",
      primaryField: "delivery_date",
      tables: [
        {
          key: "customers",
          title: "Customers",
          fields: [
            {
              label: "Status",
              columnType: "status",
              options: ["Active", "Paused"],
            },
          ],
        },
        { key: "products", title: "Products" },
        {
          key: "standing_orders",
          title: "Standing Orders",
          fields: [
            {
              label: "Status",
              columnType: "status",
              options: ["Open", "Paused"],
            },
            { label: "Delivery date", columnType: "date" },
          ],
        },
        { key: "standing_order_lines", title: "Standing Order Lines" },
      ],
      connections: [
        {
          sourceTableKey: "standing_orders",
          targetTableKey: "customers",
          label: "Customer",
          currentMultiplicity: "several",
          targetMultiplicity: "one",
        },
        {
          sourceTableKey: "standing_order_lines",
          targetTableKey: "standing_orders",
          label: "Standing order",
          currentMultiplicity: "several",
          targetMultiplicity: "one",
        },
        {
          sourceTableKey: "standing_order_lines",
          targetTableKey: "products",
          label: "Product",
          currentMultiplicity: "several",
          targetMultiplicity: "one",
        },
      ],
      records: [
        {
          tableKey: "customers",
          label: "Beth Carter",
          fields: { Status: "Active" },
        },
        { tableKey: "products", label: "Whole milk" },
        {
          tableKey: "standing_orders",
          label: "Beth's Monday order",
          fields: { Status: "Open", "Delivery date": "2026-08-17" },
        },
        { tableKey: "standing_order_lines", label: "Two bottles" },
      ],
      links: [
        {
          sourceTableKey: "standing_orders",
          targetTableKey: "customers",
          connectionLabel: "Customer",
          sourceRecordLabel: "Beth's Monday order",
          targetRecordLabels: ["Beth Carter"],
        },
        {
          sourceTableKey: "standing_order_lines",
          targetTableKey: "standing_orders",
          connectionLabel: "Standing order",
          sourceRecordLabel: "Two bottles",
          targetRecordLabels: ["Beth's Monday order"],
        },
        {
          sourceTableKey: "standing_order_lines",
          targetTableKey: "products",
          connectionLabel: "Product",
          sourceRecordLabel: "Two bottles",
          targetRecordLabels: ["Whole milk"],
        },
      ],
      queries: [
        {
          tableKey: "standing_orders",
          name: "Active Orders",
          filter: { fieldLabel: "Status", operator: "is", value: "Open" },
          sort: { fieldLabel: "Delivery date", direction: "ascending" },
          groupFieldLabel: "Status",
        },
        {
          tableKey: "standing_orders",
          name: "Orders by Customer",
          sort: { fieldLabel: "Customer", direction: "ascending" },
          groupFieldLabel: "Customer",
        },
        {
          tableKey: "customers",
          name: "Active Customers",
          filter: { fieldLabel: "Status", operator: "is", value: "Active" },
        },
        { tableKey: "standing_order_lines", name: "Active Order Lines" },
      ],
    },
    {
      concept: "Dog groomer",
      businessName: "Proof — Mobile dog groomer",
      objectKey: "dog",
      connectedObjectKey: "owner",
      primaryField: "appointment_date",
      tables: [
        {
          key: "customers",
          title: "Customers",
        },
        { key: "pets", title: "Pets" },
        {
          key: "appointments",
          title: "Appointments",
          fields: [
            {
              label: "Status",
              columnType: "status",
              options: ["Booked", "Complete"],
            },
            { label: "Appointment date", columnType: "date" },
          ],
        },
        { key: "services", title: "Services" },
      ],
      connections: [
        {
          sourceTableKey: "pets",
          targetTableKey: "customers",
          label: "Customer",
          currentMultiplicity: "several",
          targetMultiplicity: "one",
        },
        {
          sourceTableKey: "appointments",
          targetTableKey: "pets",
          label: "Pet",
          currentMultiplicity: "several",
          targetMultiplicity: "one",
        },
        {
          sourceTableKey: "appointments",
          targetTableKey: "services",
          label: "Services",
          currentMultiplicity: "several",
          targetMultiplicity: "several",
        },
      ],
      records: [
        { tableKey: "customers", label: "Aisha Khan" },
        { tableKey: "pets", label: "Milo" },
        {
          tableKey: "appointments",
          label: "Milo's Saturday groom",
          fields: { Status: "Booked", "Appointment date": "2026-08-15" },
        },
        { tableKey: "services", label: "Wash" },
        { tableKey: "services", label: "Clipping" },
      ],
      links: [
        {
          sourceTableKey: "pets",
          targetTableKey: "customers",
          connectionLabel: "Customer",
          sourceRecordLabel: "Milo",
          targetRecordLabels: ["Aisha Khan"],
        },
        {
          sourceTableKey: "appointments",
          targetTableKey: "pets",
          connectionLabel: "Pet",
          sourceRecordLabel: "Milo's Saturday groom",
          targetRecordLabels: ["Milo"],
        },
        {
          sourceTableKey: "appointments",
          targetTableKey: "services",
          connectionLabel: "Services",
          sourceRecordLabel: "Milo's Saturday groom",
          targetRecordLabels: ["Wash", "Clipping"],
        },
      ],
      queries: [
        {
          tableKey: "appointments",
          name: "Appointments this week",
          filter: {
            fieldLabel: "Appointment date",
            operator: "on_or_after",
            value: { unit: "day", amount: -3650 },
          },
          sort: { fieldLabel: "Appointment date", direction: "ascending" },
          groupFieldLabel: "Status",
        },
        { tableKey: "pets", name: "Pets by Customer" },
      ],
    },
    {
      concept: "Catering Enquiry",
      businessName: "Proof — Catering enquiry",
      objectKey: "catering_enquiry",
      connectedObjectKey: "contact",
      primaryField: "event_date",
      tables: [
        { key: "contacts", title: "Contacts" },
        {
          key: "enquiries",
          title: "Enquiries",
          fields: [
            {
              label: "Status",
              columnType: "status",
              options: ["Open", "Won", "Lost"],
            },
          ],
        },
        {
          key: "events",
          title: "Events",
          fields: [{ label: "Event date", columnType: "date" }],
        },
        {
          key: "quotes",
          title: "Quotes",
          fields: [
            {
              label: "Status",
              columnType: "status",
              options: ["Draft", "Sent", "Accepted"],
            },
          ],
        },
      ],
      connections: [
        {
          sourceTableKey: "enquiries",
          targetTableKey: "contacts",
          label: "Contact",
          currentMultiplicity: "several",
          targetMultiplicity: "one",
        },
        {
          sourceTableKey: "events",
          targetTableKey: "enquiries",
          label: "Enquiry",
          currentMultiplicity: "several",
          targetMultiplicity: "one",
        },
        {
          sourceTableKey: "quotes",
          targetTableKey: "enquiries",
          label: "Enquiry",
          currentMultiplicity: "several",
          targetMultiplicity: "one",
        },
      ],
      records: [
        { tableKey: "contacts", label: "Morgan Lee" },
        {
          tableKey: "enquiries",
          label: "Morgan's wedding enquiry",
          fields: { Status: "Open" },
        },
        {
          tableKey: "events",
          label: "Morgan's wedding",
          fields: { "Event date": "2026-09-12" },
        },
        {
          tableKey: "quotes",
          label: "Morgan's wedding quote",
          fields: { Status: "Sent" },
        },
      ],
      links: [
        {
          sourceTableKey: "enquiries",
          targetTableKey: "contacts",
          connectionLabel: "Contact",
          sourceRecordLabel: "Morgan's wedding enquiry",
          targetRecordLabels: ["Morgan Lee"],
        },
        {
          sourceTableKey: "events",
          targetTableKey: "enquiries",
          connectionLabel: "Enquiry",
          sourceRecordLabel: "Morgan's wedding",
          targetRecordLabels: ["Morgan's wedding enquiry"],
        },
        {
          sourceTableKey: "quotes",
          targetTableKey: "enquiries",
          connectionLabel: "Enquiry",
          sourceRecordLabel: "Morgan's wedding quote",
          targetRecordLabels: ["Morgan's wedding enquiry"],
        },
      ],
      queries: [
        {
          tableKey: "enquiries",
          name: "Open Enquiries",
          filter: { fieldLabel: "Status", operator: "is", value: "Open" },
        },
        {
          tableKey: "events",
          name: "Upcoming Events",
          filter: {
            fieldLabel: "Event date",
            operator: "on_or_after",
            value: "2026-08-10",
          },
          sort: { fieldLabel: "Event date", direction: "ascending" },
        },
        {
          tableKey: "quotes",
          name: "Quotes by Status",
          groupFieldLabel: "Status",
        },
      ],
    },
  ] as const;
