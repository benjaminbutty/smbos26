# SMBOS v0.1 Build Specification

**Status:** Build-ready draft  
**Date:** 27 July 2026  
**First vertical slice:** Pre-order for physical SMBs  
**Purpose:** Source of truth for the first working SMBOS repository and Codex implementation sequence.

---

## 0. Executive summary

SMBOS is not an AI app builder for technical users. It is an AI-native operating system for small physical businesses that lets an owner describe what they need in ordinary business language and receive a working, safe, editable business system.

The core product idea is deliberately simple on the surface:

> **Tell SMBOS what your business needs to do. SMBOS builds and evolves the system around your business.**

The complexity is hidden underneath. SMBOS provides a small set of platform primitives - objects, fields, relationships, views, forms, pages, rules, actions and workflows - and an AI builder that can safely compose those primitives. The business owner should not need to understand any of those terms.

The first proof is a pre-order system. A cafe, bakery or restaurant should be able to say:

> "I want customers to preorder our Mother's Day boxes, choose one of two shops and a collection slot, no payment, maximum 10 orders per slot, with 48 hours' notice."

SMBOS should create the necessary business objects, fields, relationships, public page, form, rules, admin views and confirmation workflow. The owner should then be able to say:

> "Remove Sunday collection and add an optional dietary requirements field."

That change must happen without a code change, database migration or developer deployment.

### v0.1 architectural rule

> **Businesses may create unlimited business concepts using SMBOS primitives. Only SMBOS creates new platform primitives.**

AI may create a custom object such as `Equipment`, `Pet`, `Maintenance Job` or `Catering Enquiry`. AI may add fields, relationships, views and workflows. AI may not invent executable code, arbitrary SQL, a new primitive type or a new system capability.

### v0.1 technical shape

- **Web/runtime:** Next.js + TypeScript
- **Database/Auth:** Supabase/PostgreSQL + Row Level Security
- **Hosting:** Vercel
- **Transactional email:** Resend (or equivalent behind an adapter)
- **AI:** LLM with structured tool/function calling
- **Data model:** Stable multi-tenant platform tables + metadata definitions + generic records in JSONB + explicit relationship edges
- **Change model:** AI proposes a structured change set -> validator -> preview/diff -> apply transaction -> version -> publish

The engine is the product. Pre-order is the first vertical slice through it.

---

## 1. Product thesis and non-negotiable principles

### 1.1 Target customer

Initial focus: owner-operators and small teams running physical businesses such as cafes, bakeries, restaurants, salons, barbers, independent hotels, dog groomers, florists, studios, gyms, venues, trades and independent retail.

These users commonly operate through a mixture of specialist SaaS, email, spreadsheets, WhatsApp, paper, POS tools and ad-hoc processes. Many existing flexible platforms are powerful but assume that the user understands databases, workflows, views or application-building concepts.

SMBOS must not require that knowledge.

### 1.2 Product principle: business language in, working system out

The default interaction is not:

- Create a table.
- Add a relation.
- Configure a workflow.
- Select a database field type.

It is:

> "I need to take Christmas preorders from our two shops."

The AI should ask only the minimum business questions needed to make the system useful.

### 1.3 Hidden sophistication

The underlying system can be highly structured, but the owner-facing interface should avoid exposing technical architecture unless the user explicitly asks for advanced control.

Avoid in primary UI:

- Object schema
- Foreign keys
- JSON
- Relationship cardinality
- Workflow nodes
- SQL
- Database terminology
- Prompt engineering

Use instead:

- Customers
- Products
- Orders
- Bookings
- "What would you like to change?"
- "Who should see this?"
- "When should this be available?"

### 1.4 AI is the configuration interface, not the runtime

The AI can decide how to configure SMBOS. It is not responsible for executing arbitrary production application logic.

Runtime behaviour must be deterministic and implemented by platform code.

### 1.5 Opinionated surface, flexible core

The architecture may support almost arbitrary business graphs. The onboarding experience should not feel like a blank canvas.

Templates and industry knowledge should provide sensible starting concepts. The user can then extend or change them conversationally.

### 1.6 Persistent business graph

SMBOS should not create isolated mini-apps with duplicate customers and duplicate data. New capabilities should connect to the business's existing graph wherever appropriate.

Example:

```text
Customer
  |- places -> Order
  |- makes -> Booking
  |- submits -> Catering Enquiry

Order -> Location
Booking -> Location
Catering Enquiry -> Location
```

### 1.7 Safe change over magical change

AI-generated changes must be explainable, previewable and reversible.

Every configuration change must:

1. be expressed as a structured change set;
2. pass schema and permission validation;
3. show a human-readable diff for material changes;
4. be applied transactionally;
5. create a configuration version;
6. be reversible.

### 1.8 Location is first-class

Physical business is an intentional wedge. `Location` is a platform-level concept rather than merely another optional custom object.

This allows consistent scoping of products, orders, bookings, staff, availability and future inventory.

---

## 2. Vocabulary: what users can create versus what SMBOS owns

### 2.1 Primitive

A primitive is a fundamental capability implemented and controlled by SMBOS.

v0.1 primitives:

**Graph/Data**
- Object
- Field
- Relationship
- Record

**Experience**
- View
- Form
- Page

**Behaviour**
- Rule
- Action
- Workflow

**Platform**
- Business
- Location
- User/Permission

Users do not normally see the term "primitive".

### 2.2 Object

An object is a business concept that can have records.

Examples:

- Customer
- Product
- Order
- Pet
- Room
- Catering Enquiry
- Equipment
- Maintenance Job

AI may create objects.

### 2.3 Field

A field describes a piece of information on an object.

Examples:

- Customer.email
- Order.collection_date
- Pet.breed
- MaintenanceJob.priority

AI may create and modify fields within allowed field types.

### 2.4 Relationship

A relationship describes how records from two objects connect.

Examples:

- Customer places Order
- Order collected_at Location
- Customer owns Pet
- Maintenance Job belongs_to Room

AI may create and modify relationship definitions.

### 2.5 Record

A record is one real instance of an object.

Examples:

- Customer record: Sarah Smith
- Product record: Afternoon Tea Box
- Location record: Bedford

### 2.6 Semantic type

An object may optionally carry a platform-recognised semantic type such as `customer`, `product`, `order` or `booking`.

This allows SMBOS to provide richer defaults without forcing every business into the same rigid schema.

Example:

```text
Object label: Clients
Semantic type: customer
```

The business can call it "Clients" while the platform still understands it as customer-like.

---

## 3. v0 goal, boundaries and success condition

### 3.1 Goal

Build the smallest version of SMBOS that proves all of the following:

1. A business can sign up and have isolated tenant data.
2. A working pre-order system can run on SMBOS primitives.
3. The pre-order system can be modified by changing configuration rather than application code.
4. AI can safely create and modify that configuration through controlled tools.
5. A new adjacent business concept can be added without building a new software module.
6. A published customer-facing page and an internal operating view both use the same underlying graph.

### 3.2 Reference business

Use a fictional business for repeatable development and tests:

**Bedford Bakery**

Locations:
- Bedford
- Milton Keynes

Products:
- Afternoon Tea Box - £30
- Celebration Box - £25
- Kids Afternoon Tea - £15

Pre-order requirements:
- Saturday and Sunday collection
- 11:00-16:00
- 30-minute slots
- maximum 10 orders per slot per location
- 48-hour order cutoff
- customer name, email and phone
- optional dietary requirements
- no online payment
- email confirmation
- staff order-management view

### 3.3 Explicit non-goals for v0

Do not build:

- payments
- native mobile apps
- POS integrations
- inventory deduction
- accounting
- billing/subscriptions
- marketplace integrations
- SMS
- advanced analytics
- freeform page design
- drag-and-drop workflow canvas
- arbitrary custom code
- arbitrary API execution
- user-defined SQL
- enterprise IAM
- full visual database builder
- template marketplace
- autonomous background agents

The v0 should be capable of extension later without implementing these now.

---

## 4. First user journey

### 4.1 Onboarding

1. User creates account.
2. User creates business name.
3. User selects a broad business type or chooses Other.
4. User adds one or more physical locations, or skips if not relevant.
5. SMBOS asks: **"What would you like your business to be able to do?"**

Example user response:

> "I want customers to preorder afternoon tea boxes and collect them from either shop."

### 4.2 AI discovery

AI should ask at most the minimum questions required to build a credible first version. For the reference flow:

- What products can customers preorder?
- When can customers collect?
- Is there a limit per collection slot?
- Do customers pay online or at collection?

Do not ask technical questions such as "Should Product be a separate object?"

### 4.3 Proposed build

AI shows a business-language summary:

```text
I'm going to create:
- your preorder product list
- a customer preorder form
- collection slots for Bedford and Milton Keynes
- a maximum of 10 orders per slot
- an orders screen for staff
- confirmation emails

Orders will close 48 hours before collection.
```

Buttons:
- Preview
- Build

### 4.4 Preview and publish

The user sees a live customer preview plus a simple explanation of any assumptions.

They can say:

> "Make phone optional."

AI proposes a diff and the preview updates.

When satisfied:

- Publish
- public URL becomes live

### 4.5 Day-to-day operation

The business does not need to chat with AI to operate the process.

Generated admin views should support routine work:

- Today's orders
- Upcoming orders
- Products
- Customers

AI remains available for changes and questions.

---

## 5. Primitive specification v0.1

### 5.1 Object

Purpose: define a business concept.

Required properties:

```text
id
business_id
key                 stable machine key
singular_label
plural_label
description
kind                template | custom
semantic_type       optional recognised meaning
icon                 optional
is_active
created_at
updated_at
```

Rules:

- `key` is immutable after creation.
- labels may change without breaking references.
- AI may create `custom` objects.
- AI may not create platform objects such as Business, Location or User.
- deletion is soft/archive by default.

### 5.2 Field

Purpose: define structured data on an object.

Required properties:

```text
id
business_id
object_definition_id
key
label
type
required
default_value
settings_json
position
is_active
```

v0 field types:

- short_text
- long_text
- number
- currency
- boolean
- date
- datetime
- email
- phone
- url
- select
- multi_select
- file
- status

Field behaviour is defined by `settings_json`. Example for a select:

```json
{
  "options": ["New", "Confirmed", "Ready", "Collected", "Cancelled"]
}
```

Rules:

- field `key` is immutable;
- labels can change;
- type-changing an existing populated field is a material migration and is outside normal AI edits in v0;
- AI should create a new field instead of performing unsafe coercion.

### 5.3 Relationship

Purpose: describe connections between objects.

Required properties:

```text
id
business_id
key
source_object_definition_id
target_object_definition_id
source_label
target_label
cardinality           one_to_one | one_to_many | many_to_many
is_required
is_active
```

Example:

```text
key: customer_places_order
source: Customer
target: Order
source label: places
target label: customer
cardinality: one_to_many
```

### 5.4 Record

Purpose: hold actual business data.

Required properties:

```text
id
business_id
object_definition_id
data_json
record_status
created_by
created_at
updated_at
```

`data_json` uses stable field keys:

```json
{
  "name": "Afternoon Tea Box",
  "price": 30,
  "status": "Active"
}
```

Validation occurs against active field definitions before write.

### 5.5 View

Purpose: display records to staff or customers.

v0 view types:

- table
- list
- cards
- detail
- calendar
- metric

Properties:

```text
id
business_id
key
name
view_type
object_definition_id
config_json
audience             internal | public
is_active
```

`config_json` may define:

- fields shown
- sort
- filters
- grouping
- card title/subtitle/image
- allowed row actions

No arbitrary JavaScript.

### 5.6 Form

Purpose: create or update records.

Properties:

```text
id
business_id
key
name
object_definition_id
mode                 create | edit
config_json
audience             internal | public
is_active
```

`config_json` defines ordered fields, labels/help text, hidden defaults and submit behaviour.

Relationships can be collected by form controls, for example selecting a Location or Product.

### 5.7 Page

Purpose: arrange content, views and forms into a usable surface.

v0 block types:

- heading
- text
- image
- button
- view
- form
- divider

Properties:

```text
id
business_id
key
title
slug
audience             internal | public
layout_json
status               draft | published
```

No pixel-level builder in v0. Pages are ordered sections/blocks.

### 5.8 Rule

Purpose: express deterministic constraints and conditional behaviour without executable code.

Rules use a constrained JSON DSL.

v0 rule families:

- required/validation
- visibility
- availability
- cutoff
- capacity
- allowed date/time window
- location scoping
- simple conditional default/status

Example capacity rule:

```json
{
  "type": "capacity",
  "object": "order",
  "group_by": ["location", "collection_date", "collection_time"],
  "max_records": 10,
  "where": {"status": ["New", "Confirmed"]}
}
```

Example cutoff rule:

```json
{
  "type": "cutoff",
  "field": "collection_datetime",
  "minimum_notice_hours": 48
}
```

Rules are interpreted by platform code. They are never eval'd as user code.

### 5.9 Action

Purpose: a platform-controlled capability that can be invoked by users, workflows or AI.

v0 action registry:

- create_record
- update_record
- archive_record
- set_status
- send_email
- publish_page
- notify_user

Actions are implemented in code and registered with schemas.

AI may select/configure an action. AI may not define executable action code.

### 5.10 Workflow

Purpose: trigger actions from business events.

Structure:

```text
TRIGGER
  -> optional CONDITIONS
  -> one or more ACTIONS
```

v0 triggers:

- record_created
- record_updated
- status_changed

v0 example:

```text
WHEN Order is created
IF status = Confirmed
DO send confirmation email
DO notify location staff
```

Scheduled/background workflows are deferred unless required for the first preorder slice.

### 5.11 Business

Purpose: tenant boundary.

Properties include:

```text
id
name
slug
business_type
timezone
settings_json
```

Every tenant-owned definition, configuration and record must carry `business_id`.

### 5.12 Location

Purpose: first-class physical operating location.

Properties include:

```text
id
business_id
name
slug
address_json
timezone
opening_hours_json
settings_json
is_active
```

Location may be referenced from graph records through a protected platform relationship mechanism.

### 5.13 User / Permission

v0 roles:

- owner
- admin
- staff

Minimum permissions:

- view data
- create/update operational records
- manage products/content
- change configuration
- publish
- manage users

Owner has all permissions. Staff cannot modify the graph/configuration by default.

---

## 6. Data and meta-schema

### 6.1 Architecture choice

Use a **stable platform schema with a metadata-driven business graph**.

Do not create physical SQL tables for every customer-created object in v0.

Rationale:

- creating `Catering Enquiry` should not require a migration;
- AI changes must be transactional configuration changes;
- schemas vary greatly between small businesses;
- JSONB plus definitions is sufficient for v0 volumes;
- explicit edges preserve graph relationships;
- the model can evolve later toward generated indexes/materialised projections where needed.

### 6.2 Platform tables

#### `businesses`

```text
id uuid pk
name text
slug text unique
business_type text
timezone text
settings_json jsonb
created_at timestamptz
updated_at timestamptz
```

#### `business_memberships`

```text
id uuid pk
business_id uuid fk
user_id uuid
role text
permissions_json jsonb
created_at timestamptz
unique(business_id, user_id)
```

#### `locations`

```text
id uuid pk
business_id uuid fk
name text
slug text
address_json jsonb
opening_hours_json jsonb
timezone text
settings_json jsonb
is_active boolean
created_at timestamptz
updated_at timestamptz
```

### 6.3 Graph metadata tables

#### `object_definitions`

```text
id uuid pk
business_id uuid fk
key text
singular_label text
plural_label text
description text
kind text
semantic_type text null
icon text null
is_active boolean
created_at timestamptz
updated_at timestamptz
unique(business_id, key)
```

#### `field_definitions`

```text
id uuid pk
business_id uuid fk
object_definition_id uuid fk
key text
label text
field_type text
required boolean
default_value jsonb null
settings_json jsonb
position int
is_active boolean
created_at timestamptz
updated_at timestamptz
unique(object_definition_id, key)
```

#### `relationship_definitions`

```text
id uuid pk
business_id uuid fk
key text
source_object_definition_id uuid fk
target_object_definition_id uuid fk
source_label text
target_label text
cardinality text
is_required boolean
is_active boolean
created_at timestamptz
updated_at timestamptz
unique(business_id, key)
```

### 6.4 Graph data tables

#### `records`

```text
id uuid pk
business_id uuid fk
object_definition_id uuid fk
data_json jsonb
record_status text default 'active'
created_by uuid null
created_at timestamptz
updated_at timestamptz
```

Required indexes:

- `(business_id, object_definition_id)`
- GIN index on `data_json`
- `(business_id, created_at)`

Do not prematurely create dynamic per-field indexes in v0. Add indexing only after real query evidence.

#### `record_relationships`

```text
id uuid pk
business_id uuid fk
relationship_definition_id uuid fk
source_record_id uuid fk
target_record_id uuid fk
created_at timestamptz
unique(relationship_definition_id, source_record_id, target_record_id)
```

Relationships to `Location` can initially use a reserved platform field/reference type or a dedicated `record_location_links` table. Prefer the dedicated link table if it keeps permission and filtering logic clearer.

### 6.5 Experience tables

#### `views`

```text
id uuid pk
business_id uuid fk
key text
name text
view_type text
object_definition_id uuid fk
config_json jsonb
audience text
is_active boolean
created_at timestamptz
updated_at timestamptz
```

#### `forms`

```text
id uuid pk
business_id uuid fk
key text
name text
object_definition_id uuid fk
mode text
config_json jsonb
audience text
is_active boolean
created_at timestamptz
updated_at timestamptz
```

#### `pages`

```text
id uuid pk
business_id uuid fk
key text
title text
slug text
audience text
layout_json jsonb
status text
created_at timestamptz
updated_at timestamptz
unique(business_id, slug)
```

### 6.6 Behaviour tables

#### `rules`

```text
id uuid pk
business_id uuid fk
key text
name text
rule_type text
scope_json jsonb
config_json jsonb
is_active boolean
created_at timestamptz
updated_at timestamptz
```

#### `workflows`

```text
id uuid pk
business_id uuid fk
key text
name text
trigger_json jsonb
conditions_json jsonb
actions_json jsonb
is_active boolean
created_at timestamptz
updated_at timestamptz
```

#### `workflow_runs`

Keep a minimal audit trail:

```text
id uuid pk
business_id uuid fk
workflow_id uuid fk
trigger_record_id uuid null
status text
result_json jsonb
started_at timestamptz
completed_at timestamptz null
```

### 6.7 AI/configuration tables

#### `change_sets`

```text
id uuid pk
business_id uuid fk
requested_by uuid
user_request text
status text              proposed | validated | applied | rejected
operations_json jsonb
human_summary text
validation_json jsonb
created_at timestamptz
applied_at timestamptz null
```

#### `config_versions`

Store a version number and a deterministic snapshot or snapshot reference of definitions/configuration required to roll back.

```text
id uuid pk
business_id uuid fk
version int
change_set_id uuid null
snapshot_json jsonb
created_by uuid
created_at timestamptz
```

For v0 volume, snapshotting configuration is acceptable and much simpler than an event-sourced architecture.

### 6.8 Why not generate customer SQL schemas/tables?

Because the v0 promise is conversational evolution. A statement such as:

> "We also hire equipment and I need to track returns."

must be solvable by metadata writes, not DDL migrations.

Later, if scale requires it, SMBOS can create optimised projections or indexes behind the scenes while retaining the same logical model.

---

## 7. Runtime architecture

### 7.1 High-level flow

```text
                         BUSINESS OWNER
                               |
                               v
                         AI BUILDER UI
                               |
                   proposed structured changes
                               |
                               v
                    CHANGE VALIDATION LAYER
                               |
                               v
                       BUSINESS GRAPH + CONFIG
                               |
                  +------------+------------+
                  |                         |
                  v                         v
            INTERNAL RUNTIME           PUBLIC RUNTIME
             staff/admin                 customer
```

### 7.2 Single application repository

Start with one Next.js TypeScript application rather than microservices or a monorepo.

Suggested routes:

```text
/app/...                         authenticated operating UI
/app/builder                     AI builder + preview
/p/[businessSlug]/[pageSlug]     published public page
/api/...                         controlled server endpoints
```

### 7.3 Runtime renderer

Build reusable React components that render configuration:

- FieldRenderer
- FormRenderer
- TableView
- CardView
- ListView
- DetailView
- CalendarView
- PageRenderer
- RuleEvaluator

The renderer receives validated configuration. It does not execute LLM-generated code.

### 7.4 Operational admin shell

The system should generate usable navigation from configured internal views/pages.

For the preorder slice the user might see:

```text
Home
Orders
Products
Customers
Settings
Ask SMBOS
```

Routine operations must be fast and direct. AI is primarily the building/change interface, not a mandatory chat layer for every task.

### 7.5 Public runtime

Public pages should render only published configuration.

A draft config change must not affect live customer pages until publish is explicitly applied.

Recommended v0 model:

```text
Draft configuration -> Preview
Published configuration -> Public runtime
```

Publishing can point the business to a selected config version rather than duplicating every table.

---

## 8. AI builder architecture

### 8.1 Role of AI

AI is the primary system-building interface, but it is not the only control
surface. It is a design and change assistant rather than a runtime dependency.
The AI performs four jobs:

1. understand the user's business-language request;
2. inspect the current business graph/configuration;
3. produce a structured proposed change set using supported operations;
4. explain the result in ordinary language.

AI does not directly:

- issue arbitrary SQL;
- edit application source code;
- run `eval` or generated scripts;
- bypass permissions;
- alter system primitives;
- mutate versioned configuration tables;
- validate or apply its own configuration proposal;
- publish material changes without an explicit user action.

Manual deterministic configuration and operational controls must exist before
AI operation generation depends on them. The system continues to operate when
AI is disabled or unavailable.

### 8.2 Context supplied to the model

The server builds one explicit schema-versioned Business context before any
future builder request. Its authoritative sources are the authenticated
tenant-scoped Business and current Locations plus the active immutable
configuration version. The normalized live configuration projection is not
read independently.

The model-facing projection may provide:

- business summary
- locations
- current object definitions
- field definitions
- relationship definitions
- relevant pages/views/forms
- explicit availability of rules/workflows
- current platform capability registry
- active configuration version number and revision
- user role/permissions

Operational Records and PII are never included. Configuration UUIDs, actor
identity, timestamps and checksums are also excluded. Location UUIDs are the
sole opaque references because preorder configuration already accepts them;
they remain untrusted and must be tenant/eligibility checked if returned.
Trusted active-version/head currentness stays outside the model-facing value.

The projection is strict, deterministic and bounded to 128 KiB without
truncation. It is assembled in memory, is not persisted or logged, and does not
itself invoke a provider, reserve AI usage or create a proposal.

### 8.3 Configuration and operational change lanes

Builder requests must be decomposed into one or both trusted change lanes.

The **configuration lane** covers changes to Objects, Fields, Relationships,
Views, Forms, Pages and preorder configuration such as questions, collection
days, cutoffs and capacity. AI and manual UI both enter the Milestone 5
lifecycle:

```text
strict operations
-> immutable proposal
-> candidate
-> preview
-> validation
-> deliberate Owner/Admin application
-> immutable version
```

Neither control surface may mutate the eight versioned configuration tables
directly.

The **operational lane** covers ordinary business data such as Product names
and prices, Order status, Locations and Product-to-Location availability.
These changes use narrow operational services and normal generated UI; they
are not configuration versions. Future operational undo is an explicit inverse
edit using a captured previous value, never a configuration rollback.

Compound requests must preserve the distinction and order dependencies. For
example, “Add Cambridge as another preorder collection location” means:

1. create Cambridge through the operational Location boundary;
2. propose the preorder experience change through the Milestone 5
   configuration lifecycle;
3. preview, validate and deliberately apply that proposal.

### 8.4 Change-set model

The LLM should produce operations rather than raw desired state.

Example:

```json
{
  "operations": [
    {
      "op": "create_field",
      "object_key": "order",
      "field": {
        "key": "occasion",
        "label": "Occasion",
        "type": "short_text",
        "required": false
      }
    },
    {
      "op": "add_form_field",
      "form_key": "public_preorder",
      "field_key": "occasion",
      "position": 6
    }
  ],
  "summary": "Add an optional Occasion question to every preorder."
}
```

The application parses these operations into an immutable proposal. Platform
validation is deterministic and a deliberate Owner/Admin action applies a
valid proposal. The model never writes directly to the database, validates its
own proposal or applies it.

### 8.5 AI tool/API contracts

Phase 1A gives the provider no tools or generic function executor. Later
registered builder tasks may return only schema-constrained values that the
server classifies into:

- allow-listed Milestone 5 configuration operations for an immutable proposal;
- allow-listed operational intents handled through specific narrow services;
- explicit ordered steps when a request spans both lanes.

Provider/model selection, lifecycle validation, proposal application, rollback,
publishing, credentials, database clients, arbitrary HTTP, SQL, shell and
source-code capabilities are never model-selectable tools. The server owns
implementation, authorization and deterministic validation.

### 8.5.1 Durable AI usage controls

The Phase 1A provider-neutral execution core remains independent of tenancy and
storage. A separate server-only Business-aware service validates and prepares a
registered task, derives its trusted worst-case envelope, reserves budget,
executes the prepared task, aggregates usage across every provider attempt and
settles the durable run before returning output.

Each Business has one settings row and starts disabled. The conservative v0.1
defaults and PostgreSQL hard maximums are:

| Limit | Default | Hard maximum |
| --- | ---: | ---: |
| Requests per UTC day | 25 | 1,000 |
| Input tokens per UTC day | 250,000 | 100,000,000 |
| Output tokens per UTC day | 100,000 | 50,000,000 |
| Cost per UTC day | 5,000,000 microusd | 1,000,000,000 microusd |

These are safety limits, not final commercial plans. No null limit means
unlimited. The usage day is the UTC date derived from PostgreSQL statement time
when reservation occurs. A settings-row lock serializes reservation for one
Business without holding a transaction open during provider execution or
contending with another Business.

The reservation covers maximum billable input tokens and maximum output tokens
for every allowed attempt. Integer cost is the sum of the separately rounded-up
input and output components at trusted microusd-per-million rates. Settled,
complete usage charges aggregate actual usage. Unsettled or incomplete usage
conservatively consumes at least its reservation for the captured UTC day;
actual overrun is recorded and charged without clamping. A pre-provider failure
cancels and releases the reservation. Settlement is idempotent and an
unrecordable settlement prevents model output from being returned as success.

The execution row is a metadata-only reservation and audit record. It contains
bounded Business/actor, task/policy/provider/model identity, lifecycle, safe
outcome, reserved/actual/charged usage, attempts, completeness and timestamps.
It contains no prompt, task input, instruction, candidate configuration, model
output, raw response, headers, credentials, arbitrary provider metadata or
stack trace. Owner/Admin audit reads are deterministically limited to the latest
50 rows. This accounting is a platform setting, not M5 versioned
configuration.

### 8.5.2 Milestone 7 Phase 1A bounded configuration drafting

The first post-planning drafting boundary is deliberately untrusted and
transient. `builder_configuration_draft_v1` accepts exactly a schema-v1 owner
request, the strict `AiBusinessModelContextV1`, and an already validated
ready-state `builder_plan_v1` result. It returns a strict schema-v1 object with
the required collections `objects`, `fields`, `relationships`, `views`,
`forms` and `pages`, plus one bounded owner-readable summary.

Phase 1A is additive only. Its supported draft entity kinds are Object, Field,
Relationship, View, Form and Page. All new definitions use only locally scoped
references (`draft_object_N`, `draft_field_N`, `draft_relationship_N`,
`draft_view_N`, `draft_form_N`, `draft_page_N`) and cite exact `step_N`
references from the validated ready plan. New Objects additionally bind to an
exact `concept_N` whose plan disposition is `new`. Each new concept has at most
one draft Object, and every new concept affected by a `define_object` step is
represented. Existing Objects and Fields use exact active context keys;
existing View and Form references use exact active context keys. The contract
contains no UUIDs, new stable keys, positions,
defaults, active/publication state, slugs, arbitrary JSON, operational Record
data, Relationship edges, Locations, workflows, rules, payments,
integrations, code, SQL, HTTP, tools or executable instructions.

The pure semantic validator runs synchronously without a database client. It
rechecks the existing planning validator and configuration-only six-category
boundary, then proves concept mapping, source-step coverage and exact
per-step Object scope: `define_object` steps authorize the mapped draft
concept, while `define_field`, `configure_view`, `configure_form` and
`define_relationship` steps authorize their complete target Object scope.
`configure_page` steps authorize the Objects behind every referenced View/Form
block. Existing scope is derived only from exact `existing_object_keys` or
existing concepts' exact `existing_object_key`; draft scope is derived only
from affected new concepts. It also proves local-reference uniqueness,
context resolution and activity, Field/Object ownership, typed View/Form
references, Cards image type, audience compatibility, required create-Form
coverage, deterministic duplicate-intent rules and a hard 128 KiB serialized
output limit. No free-text or fuzzy scope comparison is used. It does not
compile keys, allocate IDs, derive positions, materialise complete definitions
or create operations.

All structurally optional design properties are required by the schema and use
explicit `null` when absent; empty collections remain `[]`, and unknown
properties are rejected. Singular and plural labels may normalize to the same
value within one new Object, while labels across different new Objects share
one NFKC/case-normalized duplicate namespace.

The task is production-disabled under the separate code-owned
`builder_configuration_drafting_disabled_v1` policy. The policy is present in
both disabled and OpenAI server registries but always resolves to the disabled
provider, including when OpenAI planning is enabled. The registered drafting
output schema adapts to the existing OpenAI strict-object boundary in a
non-live test; this does not enable a drafting provider request. The existing
`builder_plan_v1` contract, Terra instruction, Terra policy and qualification
and reliability evidence remain unchanged; that planning evidence is not
evidence for this new drafting task. Any material drafting schema or validator
change invalidates planning evidence for drafting and does not reuse it.

The result is not a compiler input that can be applied directly. A later
trusted server compiler must derive collision-safe stable keys, Field
positions, complete trusted M5 definitions and operations, ordering, preserved
properties, defaults, active state, Page slugs/publication state, IDs, proposal
metadata and expected-head values before the existing propose -> validate ->
apply configuration lifecycle. Phase 1A creates no proposal and performs no
configuration or operational mutation.

The generic public Form/Page case remains incomplete. PostgreSQL currently
resolves only static public and published Pages and rejects generic public Form
submission; the public renderer also has no generic public Form action. The
current generic Form submission path creates or updates one internal Record and
offers no Relationship controls. A later reusable public Form capability is
required before full Corporate Catering Enquiry acceptance. The preserved
fixture is exactly Company name, Event date, Number of guests, Budget and Notes;
`status` is not added unless a validated owner plan explicitly requests it.

### 8.5.3 Milestone 7 Phase 1B deterministic configuration draft compiler

Phase 1B is a pure synchronous server-owned compiler under
`src/core/configuration/draft-compiler/`. It accepts the Phase 1A task-input
base contract, the strict Phase 1A configuration draft and one authoritative
immutable `ConfigurationSnapshotV1` supplied by a trusted server boundary. It
re-runs Phase 1A validation and re-resolves every existing Object, Field, Form
and View reference against the snapshot, including activity, ownership and
experience compatibility. Duplicate or inconsistent snapshot identities fail
closed; active and archived keys, slugs and Field positions remain reserved.

The compiler derives collision-safe graph keys and Page slugs with deterministic
ASCII normalisation and finite numeric suffixes. It derives Field positions
from canonical source-step/base/local-reference ordering: new Objects begin at
position zero, while existing Objects append after the greatest active or
archived position without filling gaps. It preserves nested View, Form and Page
design order and emits only complete strict `set_object`, `set_field`,
`set_relationship`, `set_form`, `set_view` and `set_page` operations in the
canonical group order Object, Field, Relationship, Form, View, Page. All Pages
compile as `draft`, including public Pages; public Form/Page intent is still not
executable, and Relationship configuration creates metadata only.

The compiler output contains no UUID, Business/actor identity, expected-head
value, candidate snapshot, ID allocation, proposal metadata or lifecycle state.
It performs no database or network access, does not load a Business, call a
provider, invoke M5 lifecycle services, validate/apply/publish changes, add a
route/UI, or mutate configuration or operational data. M5 later allocates
trusted IDs while materialising a candidate. Phase 2 supplies
authentication, exact currentness and proposal orchestration. The drafting
provider remains disabled and Terra planning evidence is unchanged and is not
compiler evidence.

### 8.5.4 Milestone 7 Phase 2 authenticated proposal-only orchestration

Phase 2 adds one authenticated, server-only handoff under
`src/ai/configuration-proposal/`. It accepts a strict request containing only
`businessId`, `expectedCurrentness` (`baseVersionId` and `headRevision`), the
Phase 1A task-input base contract and the strict Phase 1A draft. The request
does not carry actor identity, proposal metadata, operations, candidate data,
provider data or arbitrary instructions; those values are server- or
compiler-owned.

The handoff first loads authoritative Business context through the existing
session-derived Owner/Admin context source. It compares the supplied
currentness exactly and compares the supplied model context with the first
canonical `projectAiBusinessModelContext` /
`serializeAiBusinessModelContext` result exactly. It invokes the pure Phase 1B
compiler once against that first immutable configuration snapshot. It then
performs a second authoritative context load and requires the second
session-derived Business/actor identity, currentness and canonical model
context to match the first read and the expected handoff values. Any mismatch
fails closed as stale; there is no retry, rebase or context substitution.

After the second read, the handoff makes exactly one call to the existing M5
`ConfigurationChangeService.proposeChangeSet` with the compiler's strict
operations, the expected version/head, the fixed title
`Proposed configuration changes` and `description: null`. M5 remains the sole
owner of trusted IDs, candidate materialisation and operation diff. The
orchestration result is a frozen, bounded six-field object containing schema
version, proposal ID, proposed status, base version ID, base head revision and
operation count. Errors expose only finite safe codes/messages and never raw
request, context, plan, draft, provider or database details.

This phase does not validate, apply, publish, abandon, rollback, persist the
handoff, invoke a provider, add a route/UI, add a migration, alter the AI
planning/drafting registries or mutate operational data. The authenticated
Catering Enquiry proof creates one ordinary M5 proposal with ten deterministic
operations: one Object, five Fields, one Relationship, one Form, one View and
one draft Page. The Relationship is metadata only, no `status` field is
introduced, and generic public Form submission remains a later reusable
capability.

### 8.5.5 Milestone 8 Phase 8A configuration-drafting qualification gates

Phase 8A qualifies the corrected `builder_configuration_draft_v1` subject
independently of planning. An unregistered evaluation profile reuses the exact
drafting instruction, input/output schemas and semantic validator while using
the separate `builder_configuration_drafting_terra_medium_v1` policy with
`gpt-5.6-terra`, explicit `medium` reasoning, 256 KiB input, 96,000 billable
input tokens, 8,192 output tokens, two attempts, a 60-second timeout and the
existing integer $2.50/M input and $15/M output pricing. Production drafting
remains mapped to `builder_configuration_drafting_disabled_v1` in both
disabled and OpenAI modes; the evaluation profile is not registered.

The harness has exactly two frozen, schema-validated in-memory contexts
(`rich_existing_business` and `empty_new_business`) and exactly eight fixed
ready-plan scenarios: Catering Enquiry full stack, Customer marketing
consent, Customer Directory, public Customer contact page, Equipment and
Maintenance workspace, Supplier Quote field types, Staff Profile cards and
Order detail workspace. Qualification runs the ordered set once (8
executions); reliability runs three ordered sequential rounds (24 executions).
The exact one-execution reservation is 725,760 microusd; qualification derives
5,806,080 beneath a 6,000,000 hard ceiling, and reliability derives 17,418,240
beneath an 18,000,000 hard ceiling. Both live commands require their exact
opt-in flag, `AI_PROVIDER=openai` and a non-blank server-only key.

The execution core performs strict schema and semantic validation before the
deterministic scenario evaluator. Reports and setup/provider failures are
strict, finite and redacted; no owner request, context, model output, provider
response, raw error or credential is emitted or persisted. Deterministic tests
use injected providers and live commands are absent from CI. This phase adds
no database, accounting reservation, compiler, proposal, lifecycle, route,
UI, production drafting or public Form runtime. Qualification evidence is
pending deliberate live execution and reliability evidence is pending
qualification review and deliberate live execution. The next phase is
authenticated Builder orchestration (Phase 8B).

### 8.6 Validation layer

Every proposed operation must validate:

- tenant match
- user permission
- referenced object/field/view exists
- stable key uniqueness
- field type supported
- relationship references supported objects
- configuration conforms to JSON schema
- rule type supported
- workflow action exists in action registry
- change does not archive required platform components
- change does not silently destroy populated data

### 8.7 Preview/diff

Material changes should display a simple business-language diff.

Example:

```text
You're changing your preorder setup:

- Sunday collection: Available -> Unavailable
- Phone number: Required -> Optional
- New order question: Occasion (optional)

Existing orders will not be changed.
```

The underlying structured diff can be more detailed for logs.

### 8.8 Undo

`Undo that` should revert to the previous configuration version where possible.

Records created through normal business operation should not be deleted by a configuration rollback. Rollback affects definitions/configuration unless the user separately asks to change records.

---

## 9. Pre-order reference implementation

### 9.1 Template-created objects

Seed the first preorder template with these object definitions:

#### Customer

Semantic type: `customer`

Fields:

- name - short_text, required
- email - email, required
- phone - phone, required initially

#### Product

Semantic type: `product`

Fields:

- name - short_text, required
- description - long_text
- image - file
- price - currency, required
- status - status, required (`Active`, `Inactive`)

#### Order

Semantic type: `order`

Fields:

- order_number - short_text
- collection_date - date, required
- collection_time - short_text or datetime-derived slot, required
- dietary_requirements - long_text, optional
- status - status (`New`, `Confirmed`, `Ready`, `Collected`, `Cancelled`)
- created_at_display - derived at runtime, not necessarily persisted as custom field

#### Order Item

Fields:

- quantity - number, required
- unit_price - currency, required

### 9.2 Relationships

```text
Customer   --places------> Order          one_to_many
Order      --contains----> Order Item     one_to_many
Order Item --product-----> Product        many_to_one equivalent via definition
Order      --location----> Location       many_to_one platform link
```

For relationship cardinality in v0, model `many_to_one` using the inverse of `one_to_many` if keeping the enum minimal.

### 9.3 Records

Seed Product records for Bedford Bakery:

- Afternoon Tea Box - £30
- Celebration Box - £25
- Kids Afternoon Tea - £15

Seed two Locations:

- Bedford
- Milton Keynes

### 9.4 Public page

`/p/bedford-bakery/preorder`

Blocks:

1. Heading - "Preorder for collection"
2. Text - collection/cutoff summary
3. Product cards view
4. Preorder form

### 9.5 Preorder form

The UI can look like a conventional basket/checkout experience even though the underlying configuration is generic.

Fields/steps:

1. Products and quantity
2. Location
3. Collection date
4. Collection time
5. Name
6. Email
7. Phone
8. Dietary requirements
9. Submit

Submission transaction:

1. validate public page is published;
2. validate product availability;
3. validate collection rule/cutoff;
4. validate slot capacity in database transaction;
5. create/reuse Customer record where appropriate;
6. create Order record;
7. create Order Item records and relationships;
8. connect Location;
9. execute `Order created` workflow;
10. return confirmation.

### 9.6 Rules

Reference rules:

- collection days: Saturday/Sunday
- collection hours: 11:00-16:00
- slot interval: 30 minutes
- capacity: 10 accepted orders per location/date/time
- cutoff: 48 hours
- only active Products visible

`slot interval` may be implemented as a specialised configuration within the preorder form/date-time control rather than a universal rule primitive if that keeps v0 simpler. The architectural rule is to expose it through configuration, not hard-code it to Bedford Bakery.

### 9.7 Workflow

```text
WHEN Order created
DO send confirmation email to customer
DO notify relevant location/admin
```

Email content is a template/configuration, not LLM-generated at send time.

### 9.8 Internal views

Minimum:

**Orders** - table
- order number
- customer
- collection date/time
- location
- item summary
- status

**Today's collections** - filtered table/list

**Products** - cards or table with simple edit

**Customers** - table/detail

### 9.9 Required conversational change tests

Without source-code changes, AI must be able to execute:

1. "Make phone optional."
2. "Add an optional Occasion field."
3. "Remove Sunday collection."
4. "Change the cutoff from 48 to 72 hours."
5. "Add Cambridge as another collection location."
6. "Kids Afternoon Tea shouldn't be available at Bedford."
7. "Rename Celebration Box to Celebration Platter."
8. "Undo the last change."

Test 6 may expose the need for product-location availability. Implement this as configuration/relationship data, not a Bedford-specific conditional in source code.

---

## 10. Extensibility proof: create something that was not pre-built

After preorder works, do not immediately add more preorder features.

Ask SMBOS:

> "We also take corporate catering enquiries. I want company name, event date, number of guests, budget and notes, and I want them in a separate screen."

Expected AI plan:

- create object `Catering Enquiry`
- add fields: company_name, event_date, guest_count, budget, notes, status
- create relationship to Customer where useful
- create relationship to Location if required
- create public form
- create internal table view
- create page or add form to an existing page

This must require **no new platform primitive**.

Second extensibility test:

> "We hire out our private room and want customers to request a date."

If existing primitives are insufficient for availability/resource scheduling, document the gap. Do not immediately hard-code a `Private Room` module. Consider whether a new reusable platform capability such as `Scheduling/Availability` is justified.

This is how future primitives should be discovered.

---

## 11. Security and tenancy

### 11.1 Tenant isolation

Every tenant-owned table must contain `business_id` and enforce tenant isolation through PostgreSQL/Supabase Row Level Security.

A user may access a business only through an active membership.

Never rely only on frontend filtering.

### 11.2 AI security boundary

AI receives a tenant-scoped context and can only invoke tenant-scoped server operations.

The server must derive or verify `business_id`; do not trust a model-provided business identifier.

### 11.3 Public pages

Published pages expose only explicitly public views/forms/fields.

The browser must not receive broad service-role database credentials.

Public writes should go through a narrow server endpoint/RPC that:

- identifies the published business/page;
- validates form schema;
- validates rules;
- rate-limits submissions;
- performs transactional capacity checks;
- writes only allowed object/relationship types.

### 11.4 PII

v0 pre-order PII:

- name
- email
- phone
- order details

Collect only what the business configures and needs.

Do not store payment card data in v0.

### 11.5 Auditability

At minimum log:

- configuration change sets
- who applied them
- configuration versions
- publish events
- workflow execution status

Operational record history can be added later if required; do not build a full event-sourcing platform in v0.

### 11.6 Failure behaviour

If AI fails or is unavailable:

- the published business system must continue to operate;
- staff must still be able to view/manage orders;
- customers must still be able to submit valid preorders;
- only system modification/building is degraded.

This is a critical architecture requirement.

---

## 12. Required screens for v0

### 12.1 Authentication

- Sign up
- Log in
- Reset password if easy through provider defaults

### 12.2 Business onboarding

- business name
- broad business type
- locations
- primary intent prompt

### 12.3 Home

Simple operational summary:

- orders today
- upcoming collections
- quick links
- Ask SMBOS input

Avoid dashboard-building complexity.

### 12.4 Builder

Desktop-first v0 layout:

```text
+----------------------------+----------------------+
|                            | Ask SMBOS            |
|        LIVE PREVIEW        |                      |
|                            | conversation         |
|                            |                      |
|                            | [type request...]    |
+----------------------------+----------------------+
| Preview version 12                  [Publish]      |
+---------------------------------------------------+
```

Mobile can stack preview and chat.

### 12.5 Operational generated screens

- Orders
- Products
- Customers

Generated from Views, but v0 styling can be opinionated and consistent.

### 12.6 Settings

Only essential:

- Business
- Locations
- Users
- Published page link

Do not expose raw primitive editors as the default settings experience.

---

## 13. Build sequence

The implementation should be vertical and testable. Do not ask Codex to "build SMBOS" in one task.

### Milestone 0 - Repository and engineering guardrails

Deliverables:

- Next.js + TypeScript app
- lint/format/test commands
- environment validation
- Supabase local/dev connection
- `/docs/SMBOS-v0.1-Build-Spec.md`
- project instructions/AGENTS.md
- CI or at least repeatable test command

Exit criteria:

- app boots locally;
- tests run;
- database migrations can be applied from clean state.

### Milestone 1 - Multi-tenant platform foundation

Build:

- businesses
- memberships
- locations
- auth
- RLS policies
- simple admin shell

Tests:

- Business A user cannot read/write Business B data;
- staff cannot access configuration mutation endpoints;
- owner can manage their locations.

### Milestone 2 - Graph engine

Build:

- object_definitions
- field_definitions
- relationship_definitions
- records
- record_relationships
- validation service
- basic internal record CRUD API

Seed:

- Customer
- Product
- Order
- Order Item

Exit criterion:

A test can create a completely new custom object and records without a database migration.

### Milestone 3 - Experience runtime

Build:

- View definitions
- Form definitions
- Page definitions
- Table/List/Card renderers
- generic FormRenderer
- PageRenderer
- draft/public distinction

Exit criterion:

Adding a new custom field to Order and adding it to the form requires configuration only.

### Milestone 4 - Preorder vertical slice

Build:

- Bedford Bakery seed
- public preorder page
- product selection/basket interaction
- customer/order/order-item writes
- location and slot selection
- order admin view
- rule evaluator for cutoff/capacity/availability
- confirmation email workflow

Exit criterion:

A real end-to-end preorder can be placed and appears in staff Orders.

### Milestone 5 - Change/version engine

Build:

- change_sets
- validation
- human-readable diff
- config_versions
- preview version
- apply
- publish
- revert configuration

Exit criterion:

Phone can be changed from required to optional via structured change set and reverted without code changes.

### Milestone 6 - AI builder

Build in safety-ordered phases:

**Phase 1A - provider-neutral structured execution contracts**

- registered server-owned task/input/output contracts;
- provider-neutral structured generation interface;
- trusted fixed policy registry;
- bounded input, output tokens, timeout and retry behavior;
- owner-safe errors and deterministic tests;
- disabled production provider with no SDK, API-key use or network request.

Phase 1A does not create proposals, access configuration or operational data,
add a browser surface, or incur an AI API charge.

**Phase 1B - durable per-Business usage controls and safe audit**

- one default-disabled finite settings row per Business;
- UTC-day request, input-token, output-token and integer-microusd limits;
- atomic settings-row-locked worst-case reservation before execution;
- aggregate all-attempt usage and idempotent success/failure settlement;
- conservative reservation charging for incomplete or unknown usage;
- authenticated Owner/Admin settings, summary and latest-50 audit reads;
- metadata-only durable runs with no prompt, input, output or provider payload;
- service-role-only narrow reserve/settle RPCs with no direct table access.

Phase 1B adds no provider SDK, live model, route, Server Action, settings/audit
UI, context builder, proposal generation or configuration/operational
mutation. The production provider remains disabled and network-free, so no AI
API charge can be incurred.

**Before AI operation generation**

- **Phase 2A.1:** add the first manual deterministic configuration proposal
  control over the existing Milestone 5 lifecycle:
  - Owner/Admin preorder collection days, first/last collection time, slot
    interval, slot capacity, cutoff/notice and booking horizon controls;
  - server-only composition of one complete strict
    `set_preorder_experience` operation from the active immutable snapshot;
  - exact expected active version and head revision enforced under the
    PostgreSQL head lock;
  - owner-readable proposal metadata and semantic no-op rejection;
  - proposed-only submission followed by the existing candidate preview,
    deliberate validation and deliberate application;
  - no AI execution, accounting, provider request, direct projection write,
    operational Record change, automatic validation or automatic application;
- **Phase 2A.2:** add bounded deterministic preorder-question controls over the
  same lifecycle:
  - edit existing public wording, optional help and preorder-level requiredness
    while preserving the complete generic Field and preorder configuration;
  - relax an underlying globally required Field only when making a journey
    question optional, and never globally tighten a Field merely because one
    preorder requires it;
  - add short- or long-answer questions as globally optional generic Order
    Fields with server-derived keys that cannot collide with active or archived
    Fields;
  - create only strict `set_field` and `set_preorder_experience` operations,
    an ordinary proposed change set and the existing candidate preview;
  - no new primitive, domain table, migration, raw schema editor, direct
    projection write, automatic validation/application or AI execution;
- add the required narrow operational controls;
- preserve the separate configuration and operational lanes described in
  Section 8.3.

**Later builder phases**

- **Phase 3A - AI-safe Business context foundation:**
  - ordinary authenticated session/RLS loading with current Owner/Admin
    `manage_configuration` authorization;
  - Business and current active/inactive Location summaries;
  - active immutable snapshot as the sole versioned configuration source;
  - strict schema-v1 pure projection of Objects/Fields, Relationships, Views,
    Forms, Pages, preorder setup and current platform capabilities;
  - deterministic canonical ordering and 128 KiB fail-closed byte limit;
  - exact active-version/head currentness outside model-facing data;
  - no operational Records/PII, configuration UUIDs, actors, timestamps,
    checksums, persistence, provider call, AI accounting or proposal creation;
- **Phase 3B - strict Business-request planning contract:**
  - one registered `builder_plan_v1` task whose strict input is a trimmed
    1–4,000 character owner request plus the exact Phase 3A model context;
  - trusted actor/Business identity and exact base-version/head currentness
    remain outside model input;
  - one bounded clarification-or-ready output contract with owner-readable
    assumptions, questions, concepts, journeys, descriptive steps and explicit
    unsupported requirements;
  - a required zero-to-twenty concepts collection, where platform-only
    operational plans use an explicit empty array rather than inventing a
    generic Object for a first-class platform entity such as Location;
  - separate configuration and operational planning categories that are not
    tools, M5 operations or mutation authority;
  - optional pure server-owned semantic output validation inside the
    provider-neutral execution core before successful settlement;
  - authenticated composition through existing per-Business reservation and
    metadata-only accounting;
  - post-execution version, revision and canonical model-context comparison,
    discarding a known-stale plan while retaining incurred usage accounting;
  - no request/context/plan persistence, proposal, validation,
    application, publication, route, UI or operational mutation;
- **Phase 4A - external-provider safety gate and OpenAI Responses adapter:**
  - update unreleased context schema v1 in place with explicit AI-safe Page
    blocks; image/button destinations become structural kinds and raw URLs,
    credentials, hosts, paths, queries, fragments, email addresses and
    telephone numbers are excluded without changing runtime Page configuration;
  - one strict OpenAI Responses adapter using the code-owned
    `gpt-5.4-mini-2026-03-17` model, deterministic structured input, adapted
    strict JSON Schema, `store: false`, no tools and no conversation state;
  - server provider mode defaults to disabled and accepts only `disabled` or
    `openai`; OpenAI additionally requires a server-only key, while Business AI
    remains a separate gate;
  - code-owned standard pricing of 750,000 input and 4,500,000 output microusd
    per million tokens; the two-attempt planning envelope reserves exactly
    132,864 microusd using integer ceiling arithmetic;
  - refusals, content filtering, max-output incompleteness and provider/API
    failures fail closed with reported usage retained for settlement;
  - SMBOS persists no request, instruction, context, response or raw provider
    material; `store: false` is not a Zero Data Retention claim and deployment
    must review provider account data controls;
  - no operation generation, proposal, validation, application, route, Server
    Action, UI, chat persistence, operational mutation, migration or table;
- **Phase 4B - controlled real-model planning evaluation gate:**
  - evaluate the unchanged production `builder_plan_v1` task, strict schemas,
    semantic validator, instruction, Phase 3A context shape, fixed OpenAI model
    and production planning policy through the provider-neutral executor;
  - one deterministic strict synthetic local-food Business context containing
    no operational Records, customer/order data, personal identity, contact
    value, credential or tenant database row;
  - exactly eight sequential scenarios covering preorder changes, a reusable
    Catering Enquiry concept, Location creation, a compound
    Location/preorder request, unsupported automation/payment and ambiguous
    bookings;
  - deterministic hard gates for structural/semantic compatibility, result
    state, lane/category selection, unsupported honesty, reference integrity
    and compound ordering/dependency;
  - metadata-only output with no request, context, model prose, labels, UUIDs,
    provider body or persistence;
  - existing integer accounting derives a fixed 1,062,912 microusd aggregate
    maximum beneath a code-owned 1,100,000 microusd hard ceiling;
  - external execution requires `RUN_LIVE_OPENAI_EVAL=1`,
    `AI_PROVIDER=openai` and a non-blank server-only key; CI uses injected fake
    providers and never runs the live command;
  - no tenant/accounting row, route, Server Action, UI, proposal, lifecycle
    action, Record/Relationship/Location mutation, migration, table or
    primitive;
  - operation generation remains blocked until the explicit live evaluation
    succeeds and is reviewed;
- **Phase 4B.1 - bounded planning diagnostics and least-change precision:**
  - preserve the fixed model, provider, pricing, token, retry, schema, context,
    scenario and evaluator gate from Phase 4B;
  - classify invalid planning output internally as structural, semantic or
    unknown using a finite code-owned diagnostic taxonomy;
  - keep public `ai_output_invalid` errors, metadata-only accounting and audit
    records unchanged, with no raw model/provider/request/context material in
    emitted evaluation output;
  - strengthen the server-owned instruction so the owner's explicit request
    defines scope, the smallest coherent plan is preferred and adjacent work,
    guessed references and unrelated configuration are excluded;
  - keep Location-only planning concept-free and require explicit ordering and
    dependencies for a combined new Location plus later configuration request;
  - add no operation generation, proposal, mutation, route, UI, migration,
    table, primitive, second model, provider or retry path;
- **Phase 4B.2 - high-impact assumption contract alignment:**
  - preserve the fixed model, provider, pricing, token, retry, schema, context,
    scenario and evaluator gate from Phase 4B and Phase 4B.1;
  - record the second explicit live run: eight scenarios, seven passed, one
    failed, 33,453 input tokens, 3,194 output tokens, 39,468 microusd and
    29,322 ms, with the remaining `high_impact_assumption_unconfirmed`
    diagnostic on `preorder_schedule_change`;
  - strengthen the server-owned instruction with general assumption semantics:
    explicit owner requests and established Business context are not
    assumptions, the direct requested effect is not an assumption, unnecessary
    assumptions are omitted, and every high-impact assumption in a ready plan
    requires owner confirmation;
  - keep the deterministic validator rejecting high-impact assumptions without
    confirmation and accepting confirmed high-impact assumptions; do not weaken
    the validator, scenario gate, or turn semantic-invalid output into a retry;
  - record that the earlier reference and least-change failures are resolved and
    that this correction aligns the instruction with the existing validator;
  - add focused instruction, assumption, preorder-schedule, public-error and
    accounting-redaction regressions without model-output snapshots;
  - add no operation generation, proposal, mutation, route, UI, migration,
    table, primitive, second model, provider or retry path; rerun the same eight
    scenarios once more only after exact-head CI.
- **Phase 4C - GPT-5.6 Terra medium qualification and reliability gate:**
  - replace the unstable historical mini candidate with the code-owned
    `gpt-5.6-terra` alias and explicit non-overridable
    `reasoning: { effort: "medium" }`; no model, effort or policy input is
    accepted from environment (other than activation), Business, browser, task
    input, owner request, context, provider response or evaluation parameters;
  - retain exactly the approved Phase 4B.2 planning instruction, schemas,
    semantic validator, diagnostic taxonomy, synthetic context, eight owner
    requests, strict transport and deterministic hard gates;
  - use policy identity `builder_planning_terra_medium_v1`, 2,500,000 input and
    15,000,000 output microusd per million tokens, with an exact two-attempt
    reservation of 442,880 microusd and no cached-input discount; explicitly
    disable GPT-5.6 implicit prompt caching with provider-owned
    `prompt_cache_options: { mode: "explicit" }`, sending no breakpoint, key
    or retention option, until a separate cache-token accounting review;
  - provide two separate non-production gates: qualification is eight scenarios
    once, requiring `RUN_LIVE_OPENAI_TERRA_QUALIFICATION=1`; reliability is the
    same scenarios in three sequential rounds (24 executions), requiring
    `RUN_LIVE_OPENAI_TERRA_RELIABILITY=1`; both also require `AI_PROVIDER=openai`
    and a non-blank server-only key, while the historical flag is inert;
  - verify qualification's exact 3,543,040 microusd maximum under a 3,700,000
    ceiling and reliability's exact 10,629,120 maximum under an 11,000,000
    ceiling before provider construction; CI uses only injected providers;
  - emit only bounded redacted metadata and never request, inspect, persist or
    print reasoning content, request/context data, plan text, provider bodies,
    response IDs or credentials; no gate has a database, accounting, telemetry,
    file-writing, route, Server Action, UI or mutation dependency;
  - treat alias advancement and any permitted execution/planning-subject change
    as invalidating prior evidence; qualification requires reviewed 8/8, then
    reliability requires reviewed 24/24 before operation generation can begin;
  - add no fallback, other model, owner selection, prompt/schema/validator/gate
    relaxation, operation generation, proposal, mutation, migration, table or
    primitive.

**Phase 4C completion record**

The reviewed redacted live qualification completed the eight unchanged
scenarios once and passed 8/8. Structural, semantic, scenario-gate and provider
failure counts were all zero; usage was 34,949 input tokens and 3,476 output
tokens, with 139,515 estimated microusd and 47,157 ms elapsed. The reviewed
reliability run completed three sequential repetitions of the same eight
scenarios (24 executions) and passed 24/24, with every scenario passing 3/3,
one provider attempt per execution, and zero structural, semantic,
scenario-gate or provider failures; usage was 104,847 input tokens and 8,764
output tokens, with 393,585 estimated microusd and 108,779 ms elapsed.

These results clear the planning gate for the frozen Terra-medium profile as
bounded engineering evidence, not universal model perfection. Deterministic
schemas, semantic validation and scenario gates remain authoritative, and the
model has no mutation authority. Provider-backed operation generation and
builder UI remain outside Milestone 6; Milestone 7 adds only the bounded
server-owned draft compiler and authenticated proposal handoff while retaining
exact-head protection, deterministic validation and separate
configuration/operational lanes. Any material model-alias, prompt, schema,
validator, context or provider-transport change invalidates the evidence and
requires both gates to run again.
- strict configuration/operational operation generation;
- deterministic validation feedback;
- builder conversation UI and preview integration.

The model may propose configuration operations but never validates or applies
its own proposal. AI remains a design/change assistant and the deterministic
runtime has no AI dependency.

Exit criterion:

Natural-language requests in the required conversational change tests produce valid change sets and working previews.

### Milestone 7 - Extensibility proof

Run the authenticated Catering Enquiry proposal handoff using the existing
primitives. It must create exactly one ordinary M5 proposed change with the
expected Object, five Fields, Relationship, Form, View and draft Page intent;
live configuration and operational data remain unchanged, and the handoff
does not expose lifecycle controls or claim a public submission runtime.

Exit criterion:

An authenticated Owner/Admin can hand a completed bounded draft to the
existing proposal boundary with exact first/second currentness protection and
no source-code change for the business concept; later preview, deliberate
validation/application and reusable public Form capability remain separate.

At this point v0 has proven the product thesis.

---

## 14. Acceptance tests

### 14.1 Product acceptance

A non-technical tester should be able to:

1. create a business;
2. describe the preorder need in ordinary language;
3. answer a small number of business questions;
4. preview the resulting system;
5. publish it;
6. submit a customer order;
7. see the order internally;
8. change the system conversationally;
9. undo a change.

They should never need to understand objects, fields or relationships.

### 14.2 Architecture acceptance

Pass only if:

- tenant data is isolated by RLS;
- new custom objects require no SQL migration;
- custom fields require no source-code change;
- AI has no arbitrary SQL/code tool;
- runtime works when AI is unavailable;
- published config is separated from draft config;
- changes are versioned/reversible;
- workflows use registered platform actions only.

### 14.3 Preorder acceptance

Pass only if:

- product listing renders from graph records;
- only active/available products appear;
- collection location can be selected;
- invalid dates/times are unavailable;
- 48-hour cutoff is enforced server-side;
- slot capacity is enforced transactionally;
- duplicate concurrent submissions cannot exceed capacity;
- order and items are stored correctly;
- customer receives confirmation;
- staff see the order immediately;
- status can be changed to Ready/Collected/Cancelled.

### 14.4 AI change acceptance

Each request below must work without code changes:

```text
Make phone optional.
Add an optional Occasion question.
Remove Sunday collections.
Change the cutoff to 72 hours.
Add Cambridge as a location.
Don't sell Kids Afternoon Tea at Bedford.
Rename Celebration Box to Celebration Platter.
Undo that.
```

### 14.5 Extensibility acceptance

Prompt:

```text
We also take corporate catering enquiries. I need company name,
event date, number of guests, budget and notes, and I want them
on a separate screen.
```

Pass if AI creates the necessary graph and experience using existing primitives.

---

## 15. Repository structure

Keep the first repo boring and navigable.

```text
/
|- docs/
|  |- SMBOS-v0.1-Build-Spec.md
|  |- architecture-decisions.md
|
|- src/
|  |- app/
|  |  |- app/                 authenticated routes
|  |  |- p/                   public routes
|  |  |- api/                 controlled endpoints
|  |
|  |- core/
|  |  |- graph/
|  |  |- definitions/
|  |  |- records/
|  |  |- relationships/
|  |
|  |- runtime/
|  |  |- forms/
|  |  |- views/
|  |  |- pages/
|  |  |- rules/
|  |  |- workflows/
|  |
|  |- ai/
|  |  |- context/
|  |  |- tools/
|  |  |- planner/
|  |  |- changes/
|  |
|  |- db/
|  |- auth/
|  |- components/
|  |- lib/
|
|- supabase/
|  |- migrations/
|  |- seed.sql
|
|- tests/
|  |- tenancy/
|  |- graph/
|  |- runtime/
|  |- preorder/
|  |- ai/
|
|- AGENTS.md
|- package.json
```

Avoid introducing services/packages until the codebase genuinely needs the boundary.

---

## 16. Codex operating rules

Put the following principles into `AGENTS.md` or equivalent repository instructions.

### 16.1 Source of truth

Before implementing a feature, read:

1. `docs/SMBOS-v0.1-Build-Spec.md`
2. `docs/architecture-decisions.md`
3. the relevant existing tests

Do not silently diverge from the spec.

### 16.2 Implementation discipline

For each milestone/task:

1. state the implementation approach;
2. identify files/tables affected;
3. implement the smallest complete change;
4. add/update tests;
5. run typecheck, lint and tests;
6. summarise what changed and any architectural tension discovered.

### 16.3 Architectural invariants

Codex must not:

- add customer-specific hard-coded conditions;
- create a new SQL table for every custom object;
- allow AI-generated arbitrary code execution;
- bypass RLS using client-side service credentials;
- duplicate Customer/Product/Order data into separate isolated modules;
- add a new primitive merely to solve one niche example;
- add infrastructure such as queues/caches/microservices without a demonstrated requirement.

### 16.4 Preferred decision rule

When a new requirement appears:

> First ask whether it can be represented using existing primitives and configuration.

Only propose a new platform capability if the requirement is broadly reusable and cannot be expressed safely with the current model.

---

## 17. Suggested first Codex tasks

Do not run all of these as one prompt.

### Task 1 - Bootstrap

```text
Read docs/SMBOS-v0.1-Build-Spec.md in full.
Create the initial Next.js TypeScript application structure described in the spec.
Add lint, typecheck and test commands and environment validation.
Do not implement domain features yet.
Return the files changed and commands run.
```

### Task 2 - Tenant schema

```text
Implement Milestone 1 from the build spec: businesses, memberships and locations.
Create Supabase migrations and RLS policies.
Add automated tests proving a user belonging only to Business A cannot read or write Business B data.
Do not use frontend filtering as a security control.
```

### Task 3 - Graph metadata

```text
Implement object_definitions, field_definitions and relationship_definitions exactly as described in Milestone 2.
Add validation schemas and repository/service functions.
Use stable immutable keys and tenant-scoped uniqueness.
Add tests.
```

### Task 4 - Generic records

```text
Implement generic records and record_relationships.
Validate data_json against active field definitions before write.
Demonstrate in a test that a new custom object named Catering Enquiry and its records can be created without adding a migration or source-code-specific model.
```

Continue milestone by milestone. Do not ask the coding agent to invent product behaviour not specified here.

---

## 18. Decisions locked for v0.1

These should not be repeatedly reopened during implementation unless evidence proves them wrong.

1. Physical SMB is the initial wedge.
2. Location is first-class.
3. AI is the primary system-building/editing interface.
4. Routine daily operation uses normal generated UI, not mandatory chat.
5. AI composes controlled primitives; it does not generate production code.
6. Businesses can create custom objects, fields, relationships, views, forms, pages, rules and workflows.
7. Businesses cannot create new platform primitives.
8. Custom domain objects are metadata-driven and do not require per-object SQL migrations.
9. Configuration changes are proposed, validated, versioned and reversible.
10. Draft and published configuration are distinct.
11. Runtime must continue working if the AI layer is unavailable.
12. Preorder is the first vertical slice, not the final product category.
13. The first post-preorder test is an unrelated custom concept such as Catering Enquiry.

---

## 19. Open decisions to resolve during implementation, not before it

These are deliberately left flexible because real code/use will provide better evidence.

### 19.1 Location relationship storage

Either:

- dedicated platform links to Location; or
- a protected reference-field mechanism.

Choose the simpler secure implementation and document it.

### 19.2 Slot representation

A 30-minute collection slot may be:

- generated from availability configuration at runtime; or
- stored as records in a reusable availability object.

For v0, prefer runtime generation unless the need for stored slots emerges.

### 19.3 Customer deduplication

Initial heuristic may reuse a customer by normalised email within a business. Do not build full identity resolution in v0.

### 19.4 Search/indexing

Start with PostgreSQL JSONB indexing and normal tenant/object indexes. Add field-level indexes only when real queries require them.

### 19.5 Scheduling as a future primitive/capability

Do not add scheduling simply because bookings are anticipated. Test the private-room use case after preorder and only then decide whether scheduling/availability deserves a reusable platform capability.

---

## 20. Definition of "v0 complete"

v0 is complete when we can perform this demo from a clean business account:

1. Create **Bedford Bakery**.
2. Tell SMBOS:
   > "I want customers to preorder afternoon tea boxes from Bedford and Milton Keynes. They collect Saturday or Sunday between 11 and 4. Give us 48 hours' notice and don't take more than 10 orders per half-hour slot. No payment."
3. SMBOS proposes and builds the system.
4. Preview shows a usable customer preorder journey.
5. Publish it.
6. Place a real test order through the public page.
7. See it immediately in the internal Orders view.
8. Tell SMBOS:
   > "Make phone optional and add Occasion."
9. Preview and apply the change.
10. Tell SMBOS:
    > "Actually remove Sunday collection."
11. Preview and apply.
12. Tell SMBOS:
    > "Undo that."
13. Sunday returns.
14. Tell SMBOS:
    > "We also take corporate catering enquiries. I need company name, event date, guest count, budget and notes in a separate screen."
15. SMBOS creates that new concept using existing primitives without a developer or deployment.

If this works reliably, the project has proven the central SMBOS thesis:

> **A non-technical small-business owner can build and evolve software around their own business simply by describing what they need.**
