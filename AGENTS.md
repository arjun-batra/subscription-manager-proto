# AGENTS.md: rules for anyone (human or bot) working in this repo

This is a **Prototype-track** Expo app (one week, $0). Keep it light: ship working software, not paperwork.

## Hard rules

1. **Privacy: the app makes no network calls.** No analytics, crash reporting, ads, push tokens, remote config,
   rate APIs or backend. `npm run check:no-network` enforces this in CI; don't weaken it. Opening a manage URL in
   the browser is the only exception.
2. **Data stays on the device** (`expo-sqlite`). Schema changes bump `SCHEMA_VERSION` in `src/data/db.ts` with a
   migration step. Never drop user data.
3. **Expo Go compatible.** Only use modules bundled in Expo Go for the current SDK (58). Add packages with
   `npx expo install <pkg>`, never plain `npm install`. No custom native code and no `ios/` or `android/` folders.
4. **Logic lives in `src/domain/` as pure TypeScript** with Jest tests. Dates, totals, reminder selection and CSV
   parsing must stay free of React Native imports so they can be tested on Linux CI.
5. **Reminders stay within iOS's 64 pending limit**: at most `RENEWAL_BUDGET` (60) renewal reminders plus the test one.
6. **Accessibility:** new colours go in `src/ui/palette.ts` and must pass the WCAG AA test in both light and dark.
7. **Never claim it works without running it.** Before you push: `npx expo lint`, `npx tsc --noEmit`, `npx jest`,
   `npm run check:no-network`, `npm run check:expo-go`, and `npx expo export --platform ios`. Device-only behaviour (notifications firing,
   persistence across launches) must be checked on the iPhone and reported as such.

## Workflow

- Work on a feature branch, push early and often (nothing should live only on one computer), and open a PR to `main`.
- A **separate reviewer** must approve, and CI must be green, before merge. Authors don't review their own PRs.
- Log notable choices in `docs/decisions.md` (one or two lines each). No gate documents.
- Don't publish EAS Updates, create tokens or change the Expo project without Arjun's OK.

## Expo docs

Expo changes every SDK. Check the versioned docs for SDK 58 (https://docs.expo.dev/versions/v58.0.0/) rather than memory.
