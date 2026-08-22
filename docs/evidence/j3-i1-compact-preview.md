# J3-I1 compact proposed-Property evidence

This is the durable browser evidence for the compact proposed-Property correction on PR #63 (`codex/j3-i1-tables-properties`). It supplements the local screenshots previously captured under `/private/tmp`.

## Fixture and route

- Role: Owner
- Business: Proof — Milk round
- Table: Customers
- Route: `/app/proof-milk-round/workspace/customers`
- Existing Table columns used for the check: Name, Status, Standing Orders, Area, Referral source and Follow-up notes
- Active draft: `Compact preview`, Text, placed after `Follow-up notes`

## Browser results

At 1024×768, the compact Table presentation retained the primary Name column, the later Follow-up notes placement anchor and the proposed Compact preview column in original visual order. The Table’s own scroll surface absorbed the additional width (`clientWidth=742`, `scrollWidth=1235`, `scrollLeft=493`); the document stayed exactly the viewport width (`documentElement.scrollWidth=1024`, `innerWidth=1024`).

At 1440×900, the full presentation rendered the existing columns, the Follow-up notes anchor and Compact preview; the document stayed exactly 1440px wide.

At 390×844, the existing mobile Record-first behavior remained active: the desktop grid was hidden, the full-screen property editor was usable, the mobile preview notice was present, and the document stayed exactly 390px wide.

The browser console had no error or warning entries during these checks.

## Screenshots

- [1024×768 compact preview](./j3-i1-compact-preview-1024x768.png)
- [1440×900 compact preview](./j3-i1-compact-preview-1440x900.png)
- [390×844 compact preview](./j3-i1-compact-preview-390x844.png)

The screenshots are presentation evidence only. The focused unit test asserts the typed compact-column contract and original ordering; no browser state is used as configuration authority.
