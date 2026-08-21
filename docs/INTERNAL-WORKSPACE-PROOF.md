# Internal Workspace Engine — local proof

This is a local-only hands-on proof of the generic internal workspace engine. It creates four temporary Businesses through the same typed configuration and operational paths used by the application:

- `Proof — Milk round` — Customers, Products, Standing Orders, Standing Order Lines;
- `Proof — Mobile dog groomer` — Customers, Pets, Appointments, Services;
- `Proof — Catering enquiry` — Contacts, Enquiries, Events, Quotes.
- `Proof — Trades and jobs` — Customers, Jobs, Tasks.

## Run

Start the repository's local Supabase stack, then run:

```text
npm run workspace:proof:seed
```

The command refuses to run unless Supabase reports the repository-local API/database ports `55321` and `55322`. It leaves the four proof Businesses in place and prints one temporary owner email, password, and the Business slugs. Use those credentials only against the local app.

Start the app with `npm run dev`, then sign in at:

```text
http://localhost:3000/login
```

Switch Businesses using the workspace selector and visit each Business's Table workspace. The proof command already creates primary Tables, reverse Connections, shared saved Views, filtered/sorted/grouped queries, Records, and operational Connection values.

## Acceptance steps

For each Business:

1. Open a primary Table and confirm the sidebar has one entry for the Table while saved Views appear as tabs.
2. Open a saved View and confirm its filter, sort, or group is retained after refresh.
3. Edit a Connection in the Table or Record panel; confirm the connected primary label is shown and the saved View still uses the same Records.
4. Open the Page editor, create or rename an internal Page, and add Heading,
   Text, and the exact saved View key blocks. Confirm block edits, move/remove,
   and the embedded View keep the same Page currentness and authoritative
   layout without a full browser reload.
5. View the Page and confirm the embedded View keeps its query and permits
   operational Record/Connection edits without exposing structural or query
   controls. Open the source Table and a connected Record to confirm the
   existing navigation remains available.
6. Switch to the other two proof Businesses and repeat the same checks. No scenario-specific production module or route is involved.

The integration proof also checks target search bounds, batched Connection labels, pagination, one-to-many and many-to-many write semantics, configuration-head isolation for operational writes, primary-only navigation, and rejection of a foreign-Business target Record.

## Cleanup

The seed is intentionally persistent for hands-on inspection. Reset the local database when finished:

```text
npm run supabase:reset
```

That removes the temporary Businesses, Records, Connections, saved Views, and local proof identity together with the rest of the local seed state.
