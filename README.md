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
- **Free trials**: turn on **Free trial**, pick the day it ends and enter the price after the trial. The list shows
  a **Trial** badge, "Trial ends in N days" and "Free". It counts as $0 in your averages until the end date, then at
  the post-trial price; the first charge shows up in "this month" on that day. You get reminders 3 days and 1 day
  before it ends (at your reminder time), so you can cancel in time. If you add a trial after both of those times have passed (but before
  it ends), you get one catch-up reminder a minute after saving instead, and the edit screen tells you. Cancelling the item removes its reminders.
- **Payment plans** (for example paying off a phone): choose **Payment plan**, enter the amount per payment, how
  often, the next payment date, how many you've already made, and either the total number of payments or the last
  payment date. The list shows a **Plan** badge, "N of M paid" and what's left, and the home card shows the total
  left on all plans. You get a reminder before each payment ("payment 6 of 12"). After the last payment it stops
  and moves to **Completed plans**. A payment due today counts as not paid yet.
- **Bills that vary** (hydro, a phone bill with overage): turn on **Varies** and enter your best guess. The list and
  totals then say "about CA$85". After a charge, log what you were actually charged: swipe right on the row (or
  touch and hold, then **Log Amount**), or fill in **Actual amounts** on the edit screen. Once you've logged some,
  future charges are estimated as the average of the last 3 (fewer if you've logged fewer). Paid-so-far uses the
  logged amount where there is one and the estimate otherwise. Reminders fire as before and say "about" the
  current estimate. Payment plans can't vary.
- **"The 2nd Tuesday" schedules**: for monthly and every-N-months items, set **Repeats on** to **Same weekday** and
  pick the week (1st, 2nd, 3rd, 4th or last) and the day. Charges, reminders, totals and plan counts all follow it;
  "last" handles 4- and 5-week months. If the date you picked isn't that weekday, saving moves it to the next one
  (the screen tells you which).
- **Mark as paid** (Batch 3): swipe right on a row and tap **Paid**, or touch and hold and pick **Mark Paid
  (date)**. It marks the next unpaid charge, so doing it before the due date pays it early: the row moves on to the
  following charge and that charge's reminder is cancelled. An **Undo** banner shows for a few seconds, and the menu
  has **Undo Paid** afterwards. For bills that vary you can type what you paid (leave it blank to use the estimate).
  Marking a plan's last payment early completes the plan.
- **Paid this month**: a Home section under Upcoming, laid out the same way, lists every charge already billed this
  calendar month (its date has passed) and everything you marked paid this month, newest first. Payments made early
  say "paid early, due <date>"; bills that vary show the amount you logged, else "about" the estimate; trials appear
  once their first paid charge has passed; each plan instalment is its own row. It follows the category filter. Tap a
  row to open the item; swipe right (or touch and hold) for **Undo Paid** on a marked one. The five most recent show
  first, with **Show All** for the rest. **Paid so far** on the card is the total of this list (in your home
  currency), and **This month** is paid so far plus still due.
- **Promo prices and cancel-by dates**: under **Deals and deadlines** on the edit screen, set **Promo price ends**
  (the regular price and the date it starts, e.g. Rogers after 12 months) and/or **Cancel by** (a trial or anything
  with a cancellation deadline). Totals use the regular price from that date, the card shows "After the promo
  ends", Home lists both in a **Deadlines** section, and reminders fire 7 and 1 days before a promo ends and 3 and 1
  days before a cancel-by date. When the 60-reminder limit is reached, deadline reminders due in the next 60 days are kept first;
  later ones take their turn with the routine reminders.
- **Backup and restore**: Settings → **Back Up All Data** saves everything (items, categories, logos, logged
  amounts, paid marks, settings) as one `.json` file through the share sheet (Save to Files, AirDrop). **Restore
  from Backup…** picks a file, shows what's in it and asks before replacing all current data in one step. Files
  from newer app versions, damaged files, files over 10 MB and non-backups are refused with a reason, and nothing is
  changed. No account or server is involved. The file isn't encrypted (it holds your notes and links), so keep it
  somewhere private; the app deletes its own temporary copy once the share sheet or restore is done.
- **Category filter**: chips across the top of Home (All, then each category). Picking one shows only that
  category's subscriptions, trials and plans, and the totals card shows that category's totals. The choice is kept
  while the app is open and goes back to All the next time it starts.
- **Categories**: each subscription can have none, one or several. "Uncategorized" is always listed, even at 0.
  Category totals count a multi-category subscription in full in each; the overall total counts it once, and the
  screen says so when the categories add up to more. A category with items that have no exchange rate names them.
- **Totals** in your home currency: still due this month (a charge due today is still due), paid so far, this
  month's total, and the normalized monthly and yearly average. Exchange rates are typed in by you. Items with no
  rate yet are left out of totals and named on the home screen and on their categories. Rates are relative to the
  home currency, so changing the home currency clears them and the app tells you which ones to re-enter.
- **Renewal reminders**: local notifications, by default 2 days before at 9:00 AM. Each subscription or plan has its
  **next** reminder pending (a trial has its two trial reminders instead), and the soonest 60 reminders across all
  of them are kept, which stays under iOS's 64-notification limit. Later reminders, and those for subscriptions beyond the first 60, are scheduled when you
  next open the app, so open it at least once between charges. Editing an item or changing **Remind me** or
  **At** replaces its pending reminder straight away. A home-screen banner appears whenever reminders can't fire
  (permission off, or a reminder that should be pending isn't). If an item renews more often than the lead time
  (for example daily with a 2-day lead), the edit screen and Settings warn you. Settings has
  "Send Test Notification".
- **CSV import** with a checkbox preview (possible duplicates start unticked, invalid rows are shown with a
  reason and skipped), plus **CSV export** and a shareable template. Writing the ticked rows is all-or-nothing.
  Export includes whether each item is cancelled and whether its reminder is on, so a backup restores as it was.
- A **Manage Subscription** link on each item that has a manage URL, plus a shortcut to Apple's subscriptions page.
- **The look**: Home is a native iOS list (SwiftUI through `@expo/ui`): swipe left on a row to cancel or delete,
  swipe right to mark paid or log an amount, or touch and hold for a menu (Edit, Mark Paid, Log Amount, Manage, Mark Cancelled, Delete).
  Each row has a logo: a brand matched by name (77 bundled, including Canadian ones like Rogers, Sonnet and
  Canada's Wonderland, see below), one you picked, a generic icon, or a coloured first letter, the totals card has a donut of average monthly spend by category with a text legend, the progress bar
  animates, and selecting or saving gives a light haptic tap. Categories and tabs use SF Symbols. The edit screen
  uses native segmented and menu pickers. Other platforms get the plain React Native version of the same screens.
- **Logo picker**: the edit screen's **Logo** row opens a sheet with a search box and a grid: **Automatic (match
  by name)** (the default), **Brands**, and **Generic icons** (about two dozen, such as electricity, phone, gym or
  transit) with a colour row to recolour them. The pick is saved with the item and shown in the list.
- Light and dark mode. Text colours meet WCAG AA (4.5:1), chart and logo colours meet 3:1, checked by unit tests.

## Open it on your iPhone with Expo Go

**What you need**

- **Expo Go 58.0.5 or newer** from the App Store.
  - The App Store listing (seller 650 Industries, Oct 22 2026) says "This version adds support for SDK 58": <https://apps.apple.com/app/expo-go/id982107779>.
  - Expo's troubleshooting page still says App Store Expo Go stops at SDK 54: <https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/>. If your App Store won't offer 58.x, use the SDK 54 branch `fix/sdk-54` (see `docs/decisions.md`).
- Sign in to Expo Go with the same Expo account as Expo CLI (`arjunbatra`). On a physical iPhone, Expo Go has to be signed in to the same account as the CLI before it can see a dev server: <https://docs.expo.dev/troubleshooting/expo-go-sign-in-required/>.

### Option A (supported): from a computer running the dev server

```bash
git clone https://github.com/arjun-batra/subscription-manager-proto.git
cd subscription-manager-proto
npm ci                     # needs Node 22 or newer
npx expo login             # once, as arjunbatra (skip if `npx expo whoami` already says arjunbatra)
npx expo start --tunnel    # or plain `npx expo start` if the phone is on the same Wi-Fi
```

1. Wait for the QR code. With `--tunnel` it shows a URL like `http://c-arjunbatra-….on.expo.app`.
2. Scan the QR code with the iPhone **Camera** app and it opens in Expo Go. Or, in Expo Go, open the project listed under the signed-in account.
3. Keep the terminal running while you use the app. Expo Go loads the app's code from this dev server.

About `--tunnel` in Expo CLI 58:

- It uses Expo's own tunnel by default. `npx expo start --help` describes the flag as "`--tunnel [provider]` Use a tunnel. Default: expo (Legacy option: ngrok)".
- So `@expo/ngrok` isn't needed. The ngrok steps in the docs (<https://docs.expo.dev/more/expo-cli/#tunneling>) now apply only to `--tunnel ngrok`.
- Tunnel URLs are public, with random characters added. Only the app's code goes through the tunnel. Your subscriptions stay in the app's storage on the phone.

### Option B (not confirmed on a device): a published EAS Update

- Expo's expo-updates reference says: "To test the content of an update in Expo Go, run `eas update` and then browse to the update in Expo Go" (<https://docs.expo.dev/versions/latest/sdk/updates/>).
- To open a specific update group, use the URL from Expo's QR-code endpoint (`slug` defaults to `exp`, which targets Expo Go: <https://docs.expo.dev/more/qr-codes/>):
  - `https://qr.expo.dev/eas-update?projectId=397c0dd9-be0b-4d81-8d6a-4d94ce66c6be&groupId=<group id>` gives a QR code.
  - Add `&format=url` to get the `exp://u.expo.dev/<project id>/group/<group id>` link.
  - Scan it with the Camera app while Expo Go is signed in as `arjunbatra`.
- Caveats:
  - Another Expo page says "Updates published with the `runtimeVersion` field can't be loaded in Expo Go" (<https://docs.expo.dev/build/updates/#previewing-updates-in-development-builds>).
  - `eas update` always writes a `runtimeVersion` and `updates.url` into app.json and installs `expo-updates`.
  - The two pages conflict, so treat this option as untested until it opens on the phone.
- If you publish:
  - Do it from a scratch copy and don't commit those changes.
  - CI (`npm run check:expo-go`) fails if `runtimeVersion`, `updates.url` or `expo-updates` lands in the repo.
  - `expo-updates` is also on the privacy guard's banned list.

### Good to know

- When the app first asks, allow notifications so reminders can fire.
- Your data is saved in Expo Go's storage on the phone. It survives closing and reopening the app, but deleting Expo Go deletes it. Use **Settings → Export CSV** for a backup.
- Expo Go is a third-party app with its own data collection. Apple's App Store privacy label for Expo Go lists
  tracking, and data linked to you, used for third-party advertising (see the listing linked above). That's Expo
  Go's own data. This app's code adds no analytics or network calls, and your subscriptions stay in the app's
  storage on the phone.

## Develop

```bash
npm ci
npx expo lint          # lint
npx tsc --noEmit       # typecheck
npx jest               # unit tests (domain logic, storage SQL, UI helpers, the Expo Go guard); runs in America/Toronto
npm run check:no-network
npm run check:expo-go   # keeps app.json loadable in Expo Go
npx expo export --platform ios   # confirm it bundles
```

Layout:

- `src/domain/`: pure TypeScript with no React Native imports: dates and cycles, totals, reminder selection, CSV.
  All of it is unit-tested.
- `src/data/sql.ts`: storage SQL (migrations, import transaction), tested against Node's built-in SQLite.
- `src/data/db.ts`: wires it to on-device SQLite (`expo-sqlite`).
- `src/services/notifications.ts`: local notifications (`expo-notifications`). It never requests a push token.
- `src/ui/`: screens and components. Pure helpers next to them (`look.ts` for logos, symbols and the donut,
  `rows.ts` for what a row says) are unit-tested; the SwiftUI views themselves are only checked on a device.
- `src/ui/brands/`: bundled brand logos (`data.ts`, generated) and generic icons (`icons.ts`), see "Logos" below.
- `npm run check:expo-go` also fails on `expo-dev-client`, any `app.config.*` file, and any dependency that isn't a
  module Expo Go ships at the version `npx expo install` picks (a short list of pure-JavaScript packages is allowed).

## CSV format

Header row, any column order, case-insensitive, extra columns are ignored:

`name, amount, currency, cycle, next charge date, categories, notes, manage url, status, reminders, first charge date, trial end date, total payments, varies, actuals, logo, promo ends, regular price, cancel by, paid`

- `cycle`: `weekly`, `monthly`, `quarterly`, `yearly`, or `every N days|weeks|months|years`. A monthly or
  every-N-months cycle can add a weekday rule: `monthly on the 2nd tue`, `every 2 months on the last friday`
  (`1st`–`4th` or `last`, and a day name of at least 3 letters). `next charge date` must then be that weekday
- `next charge date`: `YYYY-MM-DD`
- `categories`: separated by `;`
- `status`: `active` (default) or `cancelled`; `reminders`: `on` (default) or `off`
- `first charge date`: optional `YYYY-MM-DD`, for a new subscription with nothing paid before it. For a payment
  plan it's the date of payment 1 (blank means the next charge date is payment 1)
- `trial end date`: optional `YYYY-MM-DD`, the day a free trial ends and the first charge happens. `amount` is the
  price after the trial, and `next charge date` can't be before the trial end
- `trial end date`: when set, `next charge date` must be the same day (the first charge is when the trial ends)
- `total payments`: optional whole number from 1 to 1000. Makes the row a payment plan of that many payments of
  `amount`. A row can't have both a trial and total payments. A plan's `first charge date` must fall on its
  schedule (a charge date counted back from `next charge date`)
- `varies`: `yes` for a bill whose amount changes; `amount` is then the estimate. Blank or `no` means fixed.
  Payment plans can't vary
- `actuals`: amounts logged for past charges of a `varies` row, as `date=amount` pairs separated by `;`, for
  example `2026-07-20=81.4; 2026-09-20=92.15`. Amounts are in the row's currency, with a `.` for decimals and no
  currency sign. Each date must be one of the row's charge dates and appear once. Export writes them oldest first
- `logo` (or `icon`): blank or `auto` for Automatic, `brand:<slug>` (for example `brand:netflix`, `brand:rogers`)
  or `icon:<key>` with an optional colour, `icon:bolt:amber`. Brand slugs are the `slug` values in
  `src/ui/brands/data.ts`; icon keys and colours are in `src/ui/brands/icons.ts` (colours: red, amber, green, teal,
  blue, indigo, purple, pink, graphite, brown). An unknown value makes the row invalid, with the reason shown
  Actuals can't be dated in the future
- `promo ends` + `regular price`: optional, together. Charges on or after `promo ends` (`YYYY-MM-DD`) are at
  `regular price`. Not for payment plans or bills that vary
- `cancel by`: optional `YYYY-MM-DD` deadline to cancel (reminders 3 days and 1 day before)
- `paid`: charges marked paid, as `charge@paidOn=amount` separated by `;`, for example
  `2026-11-05@2026-10-25=16.49`. Each charge must be on the schedule; the paid-on date can't be in the future
- The CSV isn't a complete copy: it has no settings or exchange rates, and doesn't keep whether a paid mark also
  logged the amount (undoing it after a CSV import leaves the logged amount). For an exact copy use **Back Up All
  Data** (JSON)
- Files without the newer columns (older exports) still import: no trial, no plan, a fixed amount
- Export puts `'` in front of any cell starting with `=`, `+`, `-` or `@` so spreadsheets don't run it as a
  formula. Import removes it again.

A missing required column (name, amount, currency, cycle, next charge date) rejects the file and nothing is written.
Use a CSV saved from Numbers, Excel or Google Sheets; `.xlsx` and `.numbers` files aren't supported.

## Logos

How an item's logo is picked:

1. **Picked in the Logo sheet** (or a CSV `logo` value): that brand or generic icon.
2. **Automatic** (the default, and what every item from before the picker uses): the name is matched against each
   brand's aliases on whole leading words, ignoring case and accents. "Rogers Wireless", "Sonnet Insurance",
   "Canada's Wonderland", "Prime", "ChatGPT Plus", "SuperGrok", "Gemini Advanced", "Office 365" and
   "Xbox Game Pass" all match. One-word aliases that are also ordinary words or other businesses' names (Max,
   Prime, Copilot, Nitro, Freedom, Shaw, Bell, Zoom, Notion, …) only match as the whole name or followed by plan
   words like "Premium", "Monthly" or "Internet", so "Prime Gym", "Max Fitness", "Copilot Money", "Nitro PDF",
   "Freedom 55" and "Shaw Academy" get a letter tile. A picked logo the app no longer has falls back to Automatic.
3. **No match**: a coloured tile with the first letter.

Brands come in two kinds:

- **Marks**: SVG paths and colours copied from [Simple Icons](https://simpleicons.org) 16.36.0, released under
  CC0 1.0, drawn with `react-native-svg` (42, for example Netflix, Cloudflare, Gemini, Claude, Google, Apple, CBC).
- **Monograms**: brands Simple Icons doesn't carry, such as Rogers, Sonnet, Canada's Wonderland, Bell, Telus, Amazon,
  Microsoft 365, Costco, Grok and ChatGPT (35). They're the brand's initials on its colour; no logo artwork is copied.

Generic icons are SF Symbols (`expo-symbols`) on a coloured tile; each has a default colour and the picker can change
it. White on every tile colour passes 4.5:1, and every brand tile's ink passes 3:1 (marks) or 4.5:1 (monograms),
checked by unit tests. Everything is bundled; nothing is downloaded.

`src/ui/brands/data.ts` is generated: unpack the `simple-icons` npm package (for example
`npm pack simple-icons@16.36.0 && tar xzf simple-icons-16.36.0.tgz`) and run `node scripts/gen-brands.js package`.
To add a brand, add it to the marks or monograms list in that script; it refuses a monogram for a brand Simple Icons
has. The names and logos are trademarks of their owners and are shown only to identify the service. See
[src/ui/brands/NOTICE.md](src/ui/brands/NOTICE.md).
