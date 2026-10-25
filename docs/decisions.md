# Decisions

Short log. Newest last. "Arjun" = approved by Arjun; "Chief" = decided within the Prototype guardrails.

| # | Date | Decision | Why | By |
|---|---|---|---|---|
| 1 | 2026-10-25 | Expo SDK 58 in Expo Go, public repo, free Expo account | No Mac build or 7-day expiry, $0, free required checks on a public repo | Arjun |
| 2 | 2026-10-25 | `expo-sqlite` for storage; local `expo-notifications` only, no push token, remote notifications disabled in config | Data stays on the device; no network | Chief |
| 3 | 2026-10-25 | Plain state navigation with three tabs and page-sheet modals, not expo-router | Fewer dependencies for a 3-screen prototype; easy to swap later | Chief |
| 4 | 2026-10-25 | Items with no exchange rate are left out of totals and named on the home screen | Gate 3 default D2; never silently dropped (FR-008) | Chief (Gate 3 default) |
| 5 | 2026-10-25 | The home card leads with "Still due this month" | Gate 3 default D3 | Chief (Gate 3 default) |
| 6 | 2026-10-25 | A subscription stores the charge date you entered as an anchor. All other charges are computed from it, backwards as well as forwards | Keeps the month-end rule exact, and counts this month's already-paid charge for subscriptions you already had | Chief |
| 7 | 2026-10-25 | One reminder per subscription (its next charge), the soonest 60 across all of them, topped up whenever the app becomes active | Stays within iOS's 64 pending; FR-011 budget minus the expiry slot, which isn't needed in Expo Go | Chief |
| 8 | 2026-10-25 | If a reminder time has already passed (for example, the charge is tomorrow with a 2-day lead), it skips to the following charge rather than firing late | Avoids surprise immediate notifications | Chief |
| 9 | 2026-10-25 | The install-expiry warning (FR-022) is skipped | Expo Go installs don't expire | Arjun (via scope) |
| 10 | 2026-10-25 | CSV dates must be `YYYY-MM-DD`; `;`-separated files are auto-detected | Avoids guessing between US and other date orders | Chief |
