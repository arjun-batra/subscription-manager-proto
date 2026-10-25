# Venture card: Subscription Manager

| | |
|---|---|
| **Track** | Prototype |
| **Time box** | 1 week (started 2026-10-25) |
| **Budget** | $0 (free Expo account, Expo Go, free GitHub Actions on a public repo) |
| **Owner** | Arjun (CEO) · run by Chief |
| **Autonomy** | Chief may merge once a separate reviewer approves and CI is green. Spending money, going public beyond this repo, or moving to the Product track needs Arjun. |
| **Success signal** | Arjun uses it on his iPhone for a week. |
| **Requirements source** | [subscription-manager/docs/requirements.md](https://github.com/arjun-batra/subscription-manager/blob/main/docs/requirements.md) (archive) |

## Scope this week

Must: add/edit/delete (FR-001, FR-003, FR-005), categories with Uncategorized always shown (FR-018),
normalized and per-category totals (FR-007, FR-018), this month / still due / paid so far (FR-019, FR-023),
local renewal reminders within the 64-pending limit plus the home warning (FR-009, FR-011), and multi-currency
with hand-entered rates (FR-008).
Stretch (done): CSV import with checkbox preview (FR-013 spreadsheet import, FR-020 preview rules), CSV export
(FR-012, CSV only), and the Manage Subscription row (FR-014, FR-024).
Out: the install-expiry warning (FR-022, not needed with Expo Go), presets (FR-002, FR-021), trials (FR-004, FR-010),
statement import (FR-015), mark as paid (FR-016), widget (FR-017), JSON export and import.

## Kill or park criteria

- **Kill** if, after the week, Arjun hasn't opened it on at least 4 of 7 days, or says he'd rather use a spreadsheet.
- **Park** if reminders don't fire reliably in Expo Go on his iPhone and fixing that would need the $99/year Apple
  Developer Program. That's a money decision for Arjun.
- **Park** if Expo Go drops SDK 58 support before the week ends and upgrading takes more than a day.
- **Promote to Product** only if Arjun keeps using it and asks for it. That needs his OK because it means a
  standalone build, the Apple Developer Program, and review, QA and release steps.
