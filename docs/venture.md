# Venture card: Subscription Manager

| | |
|---|---|
| **Track** | Prototype |
| **Time box** | 1 week (started 2026-10-25) |
| **Budget** | $0 (free Expo account, Expo Go, free GitHub Actions on a public repo) |
| **Owner** | Arjun (CEO) · run by Chief |
| **Autonomy** | Chief may merge once a separate reviewer approves and CI is green. Spending money, going public beyond this repo, or moving to the Product track needs Arjun. |
| **Success signal** | It passes the four checks below (setup, insight, reminder, trust) after a week on Arjun's iPhone. |
| **Requirements source** | [subscription-manager/docs/requirements.md](https://github.com/arjun-batra/subscription-manager/blob/main/docs/requirements.md) (archive) |

## Scope this week

Must: add/edit/delete (FR-001, FR-003, FR-005), categories with Uncategorized always shown (FR-018),
normalized and per-category totals (FR-007, FR-018), this month / still due / paid so far (FR-019, FR-023),
local renewal reminders within the 64-pending limit plus the home warning (FR-009, FR-011), multi-currency
with hand-entered rates (FR-008), free trials with a countdown and reminders 3 days and 1 day before they end
(FR-004, FR-010; added 2026-10-25 by Arjun), and instalment plans such as paying off a phone: N of M paid, what's
left, a reminder before each payment, and stopping after the last one (new, added 2026-10-25 by Arjun).
Stretch (done): CSV import with checkbox preview (FR-013 spreadsheet import, FR-020 preview rules), CSV export
(FR-012, CSV only), and the Manage Subscription row (FR-014, FR-024).
Out: the install-expiry warning (FR-022, not needed with Expo Go), presets (FR-002, FR-021), adjustable trial
reminder days (part of FR-010; fixed at 3 and 1), sort and search (FR-006), per-item lead time (part of FR-009), Manage URL validation (part of FR-014),
statement import (FR-015), mark as paid (FR-016), widget (FR-017), JSON export and import.

## Kill or park criteria

- **Judged on four checks** after the week. It's a utility, so how often it's opened doesn't count:
  1. **Setup:** Arjun can enter his real subscriptions in about 10 minutes without it feeling like a chore.
  2. **Insight:** it shows him something he didn't know, like a forgotten charge or a higher total than he thought.
  3. **Reminder:** a reminder fires on time and says something he'd act on. Test it with one due tomorrow.
  4. **Trust:** he'd keep it on his phone and rely on it to warn him before the next charge.
- **Kill** if most of the four checks fail, or he says he'd rather use a spreadsheet.
- **Park** if reminders don't fire reliably in Expo Go on his iPhone and fixing that would need the $99/year Apple
  Developer Program. That's a money decision for Arjun.
- **Park** if Expo Go drops SDK 58 support before the week ends and upgrading takes more than a day.
- **Promote to Product** only if Arjun keeps using it and asks for it. That needs his OK because it means a
  standalone build, the Apple Developer Program, and review, QA and release steps.
