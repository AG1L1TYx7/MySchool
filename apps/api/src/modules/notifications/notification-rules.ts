/** Pure rules for notifications: categories, preference defaults, delivery decisions, summaries. */

export const CATEGORIES = [
  'ANNOUNCEMENT',
  'ASSIGNMENT',
  'GRADE',
  'MESSAGE',
  'ATTENDANCE',
  'SYSTEM',
  'AI',
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Preference {
  category: Category;
  inApp: boolean;
  email: boolean;
}

/** In-app on for everything; email off by default except security and system notices. */
export function defaultPreference(category: Category): Preference {
  return { category, inApp: true, email: category === 'SYSTEM' };
}

/** Every category, with stored overrides applied on top of the defaults. */
export function mergePreferences(
  stored: Array<Pick<Preference, 'category' | 'inApp' | 'email'>>,
): Preference[] {
  return CATEGORIES.map((category) => {
    const found = stored.find((s) => s.category === category);
    return found
      ? { category, inApp: found.inApp, email: found.email }
      : defaultPreference(category);
  });
}

export interface DeliveryInput {
  category: Category;
  preference: Preference | null;
  /** Urgent items (emergency announcements, security) always email. */
  forceEmail?: boolean;
}

/** Which channels a notification takes for one recipient. */
export function deliveryFor(input: DeliveryInput): {
  inApp: boolean;
  email: boolean;
} {
  const pref = input.preference ?? defaultPreference(input.category);
  return {
    inApp: pref.inApp || !!input.forceEmail,
    email: pref.email || !!input.forceEmail,
  };
}

/** Removes duplicates and the actor who caused the event (nobody is notified about their own action). */
export function recipientsExcluding(
  ids: Array<string | null | undefined>,
  exclude: string | null | undefined,
): string[] {
  const out = new Set<string>();
  for (const id of ids) if (id && id !== exclude) out.add(id);
  return [...out];
}

export interface SummaryRow {
  category: Category;
  isRead: boolean;
}

export function summarise(rows: SummaryRow[]): {
  unread: number;
  byCategory: Record<string, number>;
} {
  const byCategory: Record<string, number> = {};
  let unread = 0;
  for (const r of rows) {
    if (r.isRead) continue;
    unread += 1;
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
  }
  return { unread, byCategory };
}

/** One-line body for a message notification: first line, trimmed, at most 120 characters. */
export function preview(content: string, max = 120): string {
  const line = content.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
