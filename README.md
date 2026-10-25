# Subscriptions (prototype)

A privacy-first subscription tracker for iPhone, built with Expo (SDK 58) and run in **Expo Go**.
Your data stays on your phone. There's no account, no analytics, no backend and no network calls in the app's code.

This is a one-week prototype. See [docs/venture.md](docs/venture.md) for the goal and kill/park rules,
and [docs/decisions.md](docs/decisions.md) for the choices made.

## What it does

- **Add, edit, cancel and delete subscriptions** with name, amount, currency, billing cycle (weekly, monthly,
  quarterly, yearly, or every N days/weeks/months/years) and next charge date. Month-end dates follow the rule
  Jan 31 → Feb 28 → Mar 31. The edit screen always shows the next upcoming charge.
- **Existing or new?** By default the app assumes a subscription was already running, so if its next charge is
  next month, this month's charge counts as paid. For a brand-new subscription, turn on **This is the first
  charge** so nothing before that date counts.
- **Categories**: each subscription can have none, one or several. "Uncategorized" is always listed, even at 0.
  Category totals count a multi-category subscription in full in each; the overall total counts it once, and the
  screen says so when the categories add up to more. A category with items that have no exchange rate names them.
- **Totals** in your home currency: still due this month (a charge due today is still due), paid so far, this
  month's total, and the normalized monthly and yearly average. Exchange rates are typed in by you. Items with no
  rate yet are left out of totals and named on the home screen and on their categories. Rates are relative to the
  home currency, so changing the home currency clears them and the app tells you which ones to re-enter.
- **Renewal reminders**: local notifications, by default 2 days before at 9:00 AM. Each subscription has its
  **next** reminder pending, for up to 60 subscriptions (the soonest ones), which stays under iOS's
  64-notification limit. Later reminders, and those for subscriptions beyond the first 60, are scheduled when you
  next open the app, so open it at least once between charges. Editing an item or changing **Remind me** or
  **At** replaces its pending reminder straight away. A home-screen banner appears whenever reminders can't fire
  (permission off, or a reminder that should be pending isn't). If an item renews more often than the lead time
  (for example daily with a 2-day lead), the edit screen and Settings warn you. Settings has
  "Send Test Notification".
- **CSV import** with a checkbox preview (possible duplicates start unticked, invalid rows are shown with a
  reason and skipped), plus **CSV export** and a shareable template. Writing the ticked rows is all-or-nothing.
  Export includes whether each item is cancelled and whether its reminder is on, so a backup restores as it was.
- A **Manage Subscription** link on each item that has a manage URL, plus a shortcut to Apple's subscriptions page.
- Light and dark mode. Text colours meet WCAG AA (4.5:1), checked by a unit test.

## Open it on your iPhone with Expo Go

You need the free **Expo Go** app from the App Store (it must support SDK 58) and the Expo account `arjunbatra`.

**Option A: a published update (no computer needed after publishing).** Once an EAS Update has been published for
this project, sign in to Expo Go as `arjunbatra`. The project appears under your account in Expo Go, or you can scan
the QR code on the update's page at
<https://expo.dev/accounts/arjunbatra/projects/subscription-manager-proto>.

**Option B: from a computer running the dev server.**

```bash
git clone https://github.com/arjun-batra/subscription-manager-proto.git
cd subscription-manager-proto
npm ci              # needs Node 22 or newer
npx expo start      # add --tunnel if the phone isn't on the same Wi-Fi
```

Scan the QR code with the iPhone Camera app and it opens in Expo Go.

When it first asks, allow notifications so reminders can fire.

**Good to know about Expo Go:** your data is saved in Expo Go's storage on the phone. It survives closing and
reopening the app, but deleting Expo Go deletes it, so use **Settings → Export CSV** for a backup. Expo Go itself
collects its own usage and crash data; this app's code doesn't add any.

## Develop

```bash
npm ci
npx expo lint          # lint
npx tsc --noEmit       # typecheck
npx jest               # unit tests for the pure logic in src/domain
npm run check:no-network
npx expo export --platform ios   # confirm it bundles
```

Layout:

- `src/domain/`: pure TypeScript with no React Native imports: dates and cycles, totals, reminder selection, CSV.
  All of it is unit-tested.
- `src/data/sql.ts`: storage SQL (migrations, import transaction), tested against Node's built-in SQLite.
- `src/data/db.ts`: wires it to on-device SQLite (`expo-sqlite`).
- `src/services/notifications.ts`: local notifications (`expo-notifications`). It never requests a push token.
- `src/ui/`: screens and components.

## CSV format

Header row, any column order, case-insensitive, extra columns are ignored:

`name, amount, currency, cycle, next charge date, categories, notes, manage url, status, reminders, first charge date`

- `cycle`: `weekly`, `monthly`, `quarterly`, `yearly`, or `every N days|weeks|months|years`
- `next charge date`: `YYYY-MM-DD`
- `categories`: separated by `;`
- `status`: `active` (default) or `cancelled`; `reminders`: `on` (default) or `off`
- `first charge date`: optional `YYYY-MM-DD`, for a new subscription with nothing paid before it
- Export puts `'` in front of any cell starting with `=`, `+`, `-` or `@` so spreadsheets don't run it as a
  formula. Import removes it again.

A missing required column (name, amount, currency, cycle, next charge date) rejects the file and nothing is written.
Use a CSV saved from Numbers, Excel or Google Sheets; `.xlsx` and `.numbers` files aren't supported.
