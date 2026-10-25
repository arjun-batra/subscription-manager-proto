import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  diffReminders,
  planReminders,
  reminderHealth,
  TEST_ID,
  type PermissionState,
  type ReminderHealth,
} from '../domain/reminders';
import type { Settings, Subscription } from '../domain/types';

/** Local notifications only. No push tokens are requested, so nothing leaves the device. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const CHANNEL = 'renewals';

async function ensureChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Renewal reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

function toState(p: Notifications.NotificationPermissionsStatus): PermissionState {
  if (Platform.OS === 'ios' && p.ios) {
    switch (p.ios.status) {
      case Notifications.IosAuthorizationStatus.AUTHORIZED:
      case Notifications.IosAuthorizationStatus.EPHEMERAL:
        return 'granted';
      case Notifications.IosAuthorizationStatus.PROVISIONAL:
        return 'provisional';
      case Notifications.IosAuthorizationStatus.NOT_DETERMINED:
        return 'undetermined';
      default:
        return 'denied';
    }
  }
  if (p.granted) return 'granted';
  return p.status === 'undetermined' ? 'undetermined' : 'denied';
}

export async function getPermission(): Promise<PermissionState> {
  return toState(await Notifications.getPermissionsAsync());
}

export async function requestPermission(): Promise<PermissionState> {
  await ensureChannel();
  return toState(
    await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    }),
  );
}

/**
 * Makes the pending set match the soonest-first plan (≤ 60 renewal reminders),
 * then re-reads what iOS actually has pending to compute the home warning.
 */
export async function syncReminders(subs: Subscription[], settings: Settings): Promise<ReminderHealth> {
  if (Platform.OS === 'web') return { ok: true };
  const permission = await getPermission();
  const plan = planReminders(subs, settings, new Date());
  if (permission === 'granted' || permission === 'provisional') {
    await ensureChannel();
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    const { toSchedule, toCancel } = diffReminders(
      plan,
      pending.map((p) => p.identifier),
    );
    for (const id of toCancel) await Notifications.cancelScheduledNotificationAsync(id);
    for (const r of toSchedule) {
      try {
        await Notifications.scheduleNotificationAsync({
          identifier: r.id,
          content: { title: r.title, body: r.body, data: { subId: r.subId } },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: r.fireAt,
            channelId: CHANNEL,
          },
        });
      } catch {
        // Left unscheduled; the health check below reports it.
      }
    }
  }
  const after = await Notifications.getAllScheduledNotificationsAsync();
  return reminderHealth(
    permission,
    plan,
    after.map((p) => p.identifier),
  );
}

export async function sendTestNotification(): Promise<void> {
  await ensureChannel();
  await Notifications.cancelScheduledNotificationAsync(TEST_ID);
  await Notifications.scheduleNotificationAsync({
    identifier: TEST_ID,
    content: { title: 'Test reminder', body: 'Reminders are working on this phone.' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5, channelId: CHANNEL },
  });
}
