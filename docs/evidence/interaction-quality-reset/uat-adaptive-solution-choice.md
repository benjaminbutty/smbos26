# Adaptive solution-choice UAT walkthrough

Date: 2026-08-25
Environment: local authenticated Owner/Admin; local Supabase fixture

## Consultancy: Companies and Opportunities

Starting workspace: Companies, People, Opportunities and Follow-ups, with an
existing Acme Ltd Company, Website redesign Opportunity and their Connection.

Submitted verbatim:

> I don’t need a separate table for opportunities, I want to be able to add
> them in a single table with companies rather than manage two tables

Tell Lenni identified the owner’s goal as working mainly from Companies. It
explained that separate Opportunities support several pieces of potential work
per Company, then offered two trusted choices:

1. Work from Companies and add Opportunities from the Company context. This
   completed without a proposal or configuration Version and supplied an Open
   Companies action.
2. Simplify around Companies. The selected continuation retained the original
   request, asked only which Opportunity details mattered, then prepared a
   normal proposal.

For the second choice, the owner selected Status and Potential work. The
ordinary configuration lifecycle produced an additive proposal, validation
succeeded and a deliberate Owner/Admin Apply created Version 3. The resulting
workspace has those two Company Properties and a saved Companies operating
view. The pre-existing Website redesign Opportunity and its Company Connection
remained intact.

## Cross-business: Customers and Pets

The equivalent request, “I don’t want Pets in a separate Table. I want to
manage them from each Customer instead.”, produced the same generic pattern:
Customer context, the benefit of several Pets per Customer, a current-workflow
choice and a Customer-centred adaptation choice. No CRM labels or rules were
used.

## Visual evidence

- [CRM explanation and options — 1440 × 900](uat-adaptive-choice-options-1440x900.png)
- [CRM trade-offs and conditional recommendation — 1440 × 900](uat-adaptive-choice-recommendation-1440x900.png)
- [CRM no-change completion — 1024 × 768](uat-adaptive-choice-no-change-1024x768.png)
- [Customer/Pet stacked choice controls — 390 × 844](uat-adaptive-choice-pets-mobile-390x844.png)
- [Applied Company-centred result with retained Connection — 1440 × 900](uat-adaptive-choice-applied-1440x900.png)

## Result

PASS — the no-change path creates no configuration artifact; the adaptation
path stays additive and proposal-led; the non-empty-data case retains related
Records; and the unrelated Customer/Pet case uses the same generic reasoning.
