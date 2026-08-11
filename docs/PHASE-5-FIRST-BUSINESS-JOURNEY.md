# Phase 5 — First Business Journey MVP

## Current capability

An unauthenticated visitor can open `/start`, choose a broad kind of work,
describe the business in ordinary language and receive a read-only Lenni
starting proposal. The proposal explains the workspace concepts, their
connections, the first operating Page and the capabilities deliberately left
out for now.

The public surface supports one initial proposal and one regeneration. It is a
bounded request-and-response experience, not a permanent conversation or chat
history.

## Acquisition state

`public.anonymous_build_sessions` is temporary platform-owned acquisition
state. It stores a hash of the HttpOnly session token, the request, category,
server-generated proposal payload, usage counters, expiry and claim state. It
does not store a Business, configuration projection or operational Record.

The browser never supplies configuration operations. The server composes and
stores them behind the hashed session token, and the authenticated claim
boundary validates them again before use.

## Claim and workspace creation

After the visitor chooses **Create this workspace**, signup/login returns to
`/start/business`. The owner supplies only a Business name and timezone. The
`claim_anonymous_build_session` transaction then:

1. authenticates the caller and resolves the temporary session by its token;
2. creates the Business and Owner membership through `create_business`;
3. reads the new empty configuration baseline and current head;
4. proposes the server-owned starter operations through the existing M5
   configuration lifecycle;
5. validates and applies the proposal in the same transaction; and
6. marks the acquisition session claimed.

Any failure rolls back the Business, membership and configuration changes. A
successful claim opens the generated internal `Today` Page.

## Starter compositions

The current deterministic compositions use existing Objects, Fields,
Relationships, Forms, Views and Pages for:

- appointments: Customers, Pets, Appointments and Services;
- delivery: Customers, Products, Orders, Order Items and Deliveries; and
- jobs: Customers, Jobs, Quotes and Tasks.

Delivery quantities are fields on Order Items. No vertical application module,
template table or new runtime primitive is created.

## Operating boundary

The generated Page and embedded Views use the existing runtime. The owner can
create real Records through existing Forms and see them in the generated View.
Those operational writes do not create configuration Versions. Configuration
is created only through the trusted proposal → validate → apply → Version
boundary.

Live model execution, permanent chat, public booking, payments, workflows,
dashboards, billing and the other Phase 5 exclusions remain outside this MVP.
