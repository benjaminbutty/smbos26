# Consultancy UAT walkthrough

Date: 2026-08-25

Business: `UAT Consultancy` (local Supabase fixture)

This walkthrough used the real workspace surfaces at 1440×900, 1024×768 and
390×844. It exercised the generic Record and Connection paths, not a
CRM-specific module.

## Walkthrough

1. Created `Acme Ltd` with only its known Company name.
2. From the Acme Record drawer, added `Sarah Jones` with role and email; the
   Company connection was created automatically.
3. Still in Acme, added `Website redesign`, entered £5,000, left Status as
   `Not known yet`, selected Sarah, and saved. Acme remained the active context.
4. From the Opportunity Record drawer, added `Send Sarah the proposal`, left
   Due date and Status unknown, selected Sarah, and saved.
5. Later enriched the Records through their Tables: Opportunity Status `Open`
   and Notes; Follow-up Due date, Status `To do` and Notes.

## Evidence

- [Home](uat-consultancy-home-1440x900.png)
- [Progressive Company](uat-consultancy-company-acme-1440x900.png)
- [Add Person](uat-consultancy-add-person-dialog-1440x900.png)
- [Acme with Sarah connected](uat-consultancy-acme-sarah-connected-1440x900.png)
- [Add Opportunity](uat-consultancy-add-opportunity-dialog-1440x900.png)
- [Acme with Opportunity connected](uat-consultancy-acme-opportunity-connected-1440x900.png)
- [Add Follow-up](uat-consultancy-add-follow-up-dialog-1440x900.png)
- [Opportunity with Follow-up connected](uat-consultancy-opportunity-follow-up-connected-1440x900.png)
- [Enriched Opportunity Table](uat-consultancy-opportunity-enriched-1440x900.png)
- [Enriched Follow-up Table](uat-consultancy-follow-up-enriched-1440x900.png)
- [Tablet-width Acme context](uat-consultancy-acme-1024x768.png)
- [Mobile Acme context](uat-consultancy-acme-mobile-390x844.png)
- [Mobile nested-create form](uat-consultancy-add-opportunity-mobile-390x844.png)

## Result

PASS — the owner can capture a partial Record, add related work without Table
hopping or manual reconnecting, and complete missing details later. The
mobile nested-create surface remains usable without stacked drawers.
