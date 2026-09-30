import { idTimestamp, newId } from './ids';

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('produces RFC 9562 version 7 ids with the RFC 4122 variant', () => {
    for (let i = 0; i < 100; i++) expect(newId()).toMatch(UUID_V7);
  });

  it('embeds the timestamp and sorts by creation order', () => {
    const t = 1_800_000_000_000;
    const a = newId(t);
    const b = newId(t);
    const c = newId(t + 1);
    expect(idTimestamp(a)).toBe(t);
    expect([c, b, a].sort()).toEqual([a, b, c]);
  });

  it('never repeats within a burst', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => newId()));
    expect(ids.size).toBe(10_000);
  });
});
