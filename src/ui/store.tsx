import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import * as db from '../data/db';
import type { ImportDraft } from '../domain/csv';
import { toLocalDate } from '../domain/dates';
import type { ReminderHealth } from '../domain/reminders';
import { DEFAULT_SETTINGS, type Category, type Settings, type Subscription } from '../domain/types';
import { syncReminders } from '../services/notifications';

interface StoreValue {
  ready: boolean;
  error: string | null;
  subscriptions: Subscription[];
  categories: Category[];
  settings: Settings;
  today: string;
  health: ReminderHealth;
  saveSubscription(s: Subscription): Promise<void>;
  deleteSubscription(id: string): Promise<void>;
  saveCategory(c: Category): Promise<void>;
  deleteCategory(id: string): Promise<void>;
  saveSettings(s: Settings): Promise<void>;
  importDrafts(d: ImportDraft[]): Promise<number>;
  /** Replaces all data with a backup's (all-or-nothing), then reschedules reminders. */
  restoreAll(s: db.Snapshot): Promise<number>;
  refresh(): Promise<void>;
  /** Home's category filter: null is All. Kept in memory only, so it resets on the next launch. */
  categoryFilter: string | null;
  setCategoryFilter(id: string | null): void;
}

const Ctx = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<db.Snapshot>({ subscriptions: [], categories: [], settings: DEFAULT_SETTINGS });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(() => toLocalDate(new Date()));
  const [health, setHealth] = useState<ReminderHealth>({ ok: true });
  const snapRef = useRef(snap);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const resync = useCallback(async (s: db.Snapshot) => {
    try {
      setHealth(await syncReminders(s.subscriptions, s.settings));
    } catch (e) {
      setHealth({ ok: false, reason: 'missing', missing: [], message: `Reminders couldn’t be scheduled: ${String(e)}` });
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await db.loadAll();
      snapRef.current = s;
      setSnap(s);
      setToday(toLocalDate(new Date()));
      setReady(true);
      await resync(s);
    } catch (e) {
      setError(String(e));
      setReady(true);
    }
  }, [resync]);

  useEffect(() => {
    // Open the database first, then load (setState happens in the callback, not the effect body).
    db.getDb().then(refresh, (e) => {
      setError(String(e));
      setReady(true);
    });
    // Recalculate "today" and re-check reminders whenever the app becomes active.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    // Also roll over at local midnight while the app stays open.
    const timer = setInterval(() => {
      const t = toLocalDate(new Date());
      setToday((prev) => (prev === t ? prev : t));
    }, 30_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [refresh]);

  const wrap = useCallback(
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
      async (...a: A): Promise<R> => {
        const r = await fn(...a);
        await refresh();
        return r;
      },
    [refresh],
  );

  const restoreAll = useCallback(
    async (s: db.Snapshot) => {
      const n = await db.restoreAll(s);
      // The filter may point at a category the backup doesn't have.
      setCategoryFilter(null);
      await refresh();
      return n;
    },
    [refresh],
  );

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      error,
      ...snap,
      today,
      health,
      saveSubscription: wrap(db.saveSubscription),
      deleteSubscription: wrap(db.deleteSubscription),
      saveCategory: wrap(db.saveCategory),
      deleteCategory: wrap(db.deleteCategory),
      saveSettings: wrap(db.saveSettings),
      importDrafts: wrap(db.importDrafts),
      restoreAll,
      refresh,
      categoryFilter,
      setCategoryFilter,
    }),
    [ready, error, snap, today, health, wrap, refresh, restoreAll, categoryFilter],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}
