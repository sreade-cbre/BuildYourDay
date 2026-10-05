import { describe, expect, it } from 'vitest';
import { Holds, type Claim } from '../src/scene/holds';

const pose = { baseY: 0, height: 3, x: 0, z: 0 };

function claim(overrides: Partial<Claim> = {}): Claim {
  return { pose: null, labelOpacity: 1, quiet: [], ...overrides };
}

describe('Holds', () => {
  it('lets the first claim on a block decide what it shows', () => {
    const holds = new Holds();
    const hidden = holds.claim('a', claim());
    const posed = holds.claim('a', claim({ pose }));
    expect(holds.current('a')).toBe(hidden);
    expect(holds.isHidden('a')).toBe(true);
    holds.release('a', hidden);
    expect(holds.current('a')).toBe(posed);
    expect(holds.isHidden('a')).toBe(false);
    holds.release('a', posed);
    expect(holds.isClaimed('a')).toBe(false);
  });

  it('tells a claim when it becomes first, at once or when the one ahead lets go', () => {
    const holds = new Holds();
    const seen: string[] = [];
    const first = holds.claim('a', claim({ onFirst: () => seen.push('first') }));
    holds.claim('a', claim({ onFirst: () => seen.push('second') }));
    expect(seen).toEqual(['first']);
    holds.release('a', first);
    expect(seen).toEqual(['first', 'second']);
  });

  it('keeps gap outlines quiet for every pending claim, not only the first', () => {
    const holds = new Holds();
    holds.claim('a', claim({ quiet: [{ start: 540, end: 600 }] }));
    holds.claim('a', claim({ quiet: [{ start: 600, end: 660 }] }));
    holds.claim('b', claim({ quiet: [{ start: 720, end: 780 }] }));
    expect(holds.quietRanges()).toHaveLength(3);
  });

  it('follows the first site claim and returns the site to the data once all are gone', () => {
    const holds = new Holds();
    expect(holds.siteMode).toBeNull();
    const build = holds.claimSite('build');
    const freeze = holds.claimSite('freeze');
    expect(holds.siteMode).toBe('build');
    holds.releaseSite(build);
    expect(holds.siteMode).toBe('freeze');
    holds.releaseSite(freeze);
    expect(holds.siteMode).toBeNull();
  });
});
