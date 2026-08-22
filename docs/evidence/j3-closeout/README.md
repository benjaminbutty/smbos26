# Journey 3 closeout evidence index

Date: 23 August 2026

This index joins the durable checkpoint evidence into one Journey 3 acceptance
pack. The J3-I5 browser pass was read-only: it preserved the owner-review
fixtures and created no configuration or operational mutation.

## Cross-business browser evidence

| Business and role | Viewport | Evidence | Result |
| --- | --- | --- | --- |
| Milk round, Owner | 1440x900 | [Standing Orders](./owner-milk-round-1440x900.jpg) | Table, shared Saved View tabs, mixed columns and structural controls; no overflow or browser warnings/errors |
| Mobile dog groomer, Owner | 1024x768 | [Appointments](./owner-dog-groomer-1024x768.jpg) | Saved Appointments view and connected Pet column; no overflow or browser warnings/errors |
| Catering enquiry, Owner | 390x844 | [Enquiries](./owner-catering-390x844.jpg) | Deliberate Record-first mobile Table and shared Open Enquiries tab; no overflow or browser warnings/errors |
| Trades/jobs, Owner | 390x844 | [Jobs](./owner-trades-390x844.jpg) | Scheduled Jobs tab and mobile operating surface; no overflow or browser warnings/errors |
| Milk round, Admin | 1024x768 | [Standing Orders](./admin-milk-round-1024x768.jpg) | Same structural controls as Owner, including Add property and Create saved view |
| Bedford Bakery, Staff | 1024x768 | [Orders](./staff-bedford-orders-1024x768.jpg) | Complete operating Table with structural controls, Changes and Tell Lenni absent |

All four business shapes came from the existing generic
`internal-workspace-engine` fixture and production runtime. No screenshot uses
a business-specific runtime branch.

## Public regression

- [Bedford public preorder at 1440x900](./public-bedford-1440x900.jpg)
- [Bedford public preorder at 1024x768](./public-bedford-1024x768.jpg)
- [Bedford public preorder at 390x844](./public-bedford-390x844.jpg)

At every width the public Page retained the exact bounded Page renderer,
products, locations, customer details and preorder submission capability.
`scrollWidth === clientWidth`, and browser warning/error logs were empty.

## Checkpoint evidence

- J3-I1: [Property compact-preview ledger](../j3-i1-compact-preview.md) and
  screenshots at all required widths.
- J3-I2: [Saved Views and Connections ledger](../j3-i2/README.md), including
  draft preview, stale retention, Staff access and exact configuration versus
  operational Version counts.
- J3-I3: [Internal Pages ledger](../j3-i3-ledger.md), including the corrected
  Notion-style canvas, Reading mode, Staff state and one-Version reorder.
- J3-I4: [Site publication ledger](../j3-i4-ledger.md), including unchanged
  public content before publish and one atomic published result afterward.

## Local automated gates

```text
npm run check
  90 files, 964 tests passed
npm run build
  production build passed
npm run test:integration
  26 files, 268 passed, 5 deliberately skipped
  includes 19/19 RLS tests
npm run workspace:proof:seed
  2/2 four-business proof tests passed
npm run check:migration-immutability
  43 historical migrations passed
npm run supabase:reset
  clean replay through the J3-I4 publication migration passed
npm run supabase:lint
  no schema errors
```

No live provider evaluation was run. Journey 3 was operated manually with no
AI dependency.
