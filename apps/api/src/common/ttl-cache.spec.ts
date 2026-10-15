import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('serves an entry until it expires, and forgets it on delete or clear', () => {
    let t = 1000;
    const cache = new TtlCache<string>(100, 10, () => t);
    cache.set('a', 'one');
    expect(cache.get('a')).toBe('one');
    t = 1099;
    expect(cache.get('a')).toBe('one');
    t = 1100;
    expect(cache.get('a')).toBeUndefined();
    cache.set('b', 'two');
    cache.delete('b');
    expect(cache.get('b')).toBeUndefined();
    cache.set('c', 'three');
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('sweeps expired entries first and then the oldest half when full', () => {
    let t = 0;
    const cache = new TtlCache<number>(50, 4, () => t);
    cache.set('a', 1);
    cache.set('b', 2);
    t = 60; // a and b expired
    cache.set('c', 3);
    cache.set('d', 4);
    cache.set('e', 5); // full: a and b are swept, nothing live is lost
    expect(cache.get('c')).toBe(3);
    expect(cache.get('e')).toBe(5);
    cache.set('f', 6);
    cache.set('g', 7); // full of live entries: the oldest half goes
    expect(cache.size).toBeLessThanOrEqual(4);
    expect(cache.get('g')).toBe(7);
  });
});
