import {
  CATEGORIES,
  defaultPreference,
  deliveryFor,
  mergePreferences,
  preview,
  recipientsExcluding,
  summarise,
} from './notification-rules';

describe('notification rules', () => {
  it('defaults to in-app for everything and email only for system notices', () => {
    expect(defaultPreference('GRADE')).toEqual({
      category: 'GRADE',
      inApp: true,
      email: false,
    });
    expect(defaultPreference('SYSTEM').email).toBe(true);
    const merged = mergePreferences([
      { category: 'GRADE', inApp: false, email: true },
    ]);
    expect(merged).toHaveLength(CATEGORIES.length);
    expect(merged.find((p) => p.category === 'GRADE')).toEqual({
      category: 'GRADE',
      inApp: false,
      email: true,
    });
    expect(merged.find((p) => p.category === 'MESSAGE')).toEqual(
      defaultPreference('MESSAGE'),
    );
  });

  it('honours preferences but never silences forced (urgent) items', () => {
    expect(
      deliveryFor({
        category: 'ANNOUNCEMENT',
        preference: { category: 'ANNOUNCEMENT', inApp: false, email: false },
      }),
    ).toEqual({ inApp: false, email: false });
    expect(
      deliveryFor({
        category: 'ANNOUNCEMENT',
        preference: { category: 'ANNOUNCEMENT', inApp: false, email: false },
        forceEmail: true,
      }),
    ).toEqual({ inApp: true, email: true });
    expect(deliveryFor({ category: 'MESSAGE', preference: null })).toEqual({
      inApp: true,
      email: false,
    });
  });

  it('dedupes recipients and drops the actor', () => {
    expect(
      recipientsExcluding(['a', 'b', 'a', null, undefined, 'c'], 'b'),
    ).toEqual(['a', 'c']);
  });

  it('summarises unread counts by category and previews message text', () => {
    expect(
      summarise([
        { category: 'GRADE', isRead: false },
        { category: 'GRADE', isRead: true },
        { category: 'MESSAGE', isRead: false },
      ]),
    ).toEqual({ unread: 2, byCategory: { GRADE: 1, MESSAGE: 1 } });
    expect(preview('  Hello\n\nthere   friend ')).toBe('Hello there friend');
    expect(preview('x'.repeat(200)).length).toBe(120);
  });
});
