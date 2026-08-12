# Phase 5 — First Business Journey MVP

## Current capability

An unauthenticated visitor can open `/start`, choose one of six broad context
hints, describe the business in ordinary language and receive a read-only Lenni
starting proposal before signup:

- Appointments & bookings
- Orders & delivery
- Jobs & projects
- Enquiries & sales
- Products & stock
- Something else

The public experience is one initial request, one proposal and one edited
regeneration. It is not permanent chat, conversation history, memory or an
open-ended clarification session.

## Tailored acquisition planning

The acquisition path is:

```text
category hint + ordinary description
        ↓
acquisition_workspace_plan_v1
        ↓
strict semantic validation
        ↓
existing configuration-drafting grammar and semantic validator
        ↓
existing deterministic draft compiler
        ↓
owner-readable proposal
```

The acquisition planner has no tools, database access or mutation authority. It
selects the smallest coherent set of reusable business areas, tracked
information, ordinary-language connections and a neutral internal `Overview`
Page. It must not create a custom `Location`/`Locations` business Table;
Location is a first-class platform concept and remains optional and
contextual. The deterministic validator also rejects that identity after NFKC
and case normalisation.

The proposal explains what Lenni understood, why the structure fits, the
business areas and information being tracked, connections, saved Views, the
starting Page and unsupported requests. It does not expose schema, JSON,
technical references or raw model output.

## Acquisition state, privacy and usage

`public.anonymous_build_sessions` is temporary platform-owned acquisition
state. It stores a hash of the HttpOnly session token, request/category context,
the server-generated proposal payload, usage counters, expiry and claim state.
It is not Business data, configuration history or operational Record data.

The public allowance is one initial proposal plus one regeneration per session.
A separate server-owned daily HMAC-keyed ceiling prevents replacing the browser
cookie from providing unlimited model attempts. Reservations are atomic and
occur before provider execution. The public policy has finite input/output,
timeout, attempt and cost bounds; the model has no tools and no database
client.

The free-text input carries a quiet warning not to include customer names,
email addresses, phone numbers or other personal information. Raw prompts and
model output are not sent to analytics or application logs. A successful claim
scrubs temporary request/proposal material immediately. Expired unclaimed
state is scrubbed opportunistically and removed after the bounded retention
window documented by the acquisition implementation.

## Claim and workspace creation

After the visitor chooses **Create this workspace**, signup/login returns to
`/start/business`. The owner supplies only a Business name and confirms the
browser-suggested IANA timezone. The authenticated claim transaction then:

1. resolves the temporary session by its server-owned token;
2. creates the Business and Owner membership through `create_business`;
3. reads the new empty configuration baseline and current head;
4. validates and compiles the owner-approved proposal through the existing M5
   configuration lifecycle;
5. applies one starting configuration atomically; and
6. marks the acquisition session claimed.

Any failure rolls back the Business, membership and configuration changes. A
successful claim opens the generated internal `Overview` Page.

## Starter compositions and fallback

Tailored interpretation can produce different reusable structures for the same
broad category. For example, dog grooming may include Customers, Pets,
Appointments and Services, while a hair salon may use Customers, Appointments
and Services without Pets. A milk round can use Customers, Products, Regular
Orders, Order Items and Deliveries, with quantities on the item/line concept.

The deterministic fallback remains available when AI is disabled or unavailable
and is described honestly as a reliable starting point rather than as tailored
understanding. Its broad starters are:

- appointments: Customers, Appointments and Services;
- delivery: Customers, Products, Orders, Order Items and Deliveries;
- jobs: Customers, Jobs, Quotes and Tasks;
- enquiries/other: Customers, Enquiries and Follow-ups; and
- products: Products with manually maintained stock information.

These are compositions of existing Objects, Fields, Relationships, Forms,
Views and Pages. They are not vertical application modules, templates with a
separate runtime or new SMBOS primitives. The manual route remains available
without AI.

## Operating boundary

The generated `Overview` Page embeds a real saved View and uses the existing
generic Record runtime. The owner can create real Records through generated
Forms and see them in the appropriate View. Those operational writes do not
create configuration Versions. Initial structure is created only through the
trusted proposal → validate → apply → Version boundary.

Phase 5 does not provide permanent Lenni conversation/history, public booking,
public generic Forms, payments, workflows or automation, dashboards or
analytics, billing, integrations, customer portals, inventory automation,
Location orchestration, autonomous AI application, a visual schema builder,
mobile apps or a new vertical runtime.

### ADR-038 implementation note — superseded deferred items

The later Internal Workspace Engine work supersedes only the ADR-038 deferment
of Connections, saved Views, filtering, sorting and grouping. It does so through
the existing generic primitives and typed M5/operational boundaries; formulas,
workflows, public editing, collaboration and AI/Builder Table changes remain
deferred. See ADR-039 and `docs/INTERNAL-WORKSPACE-ENGINE.md`.
