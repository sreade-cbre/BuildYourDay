import { describe, expect, it } from 'vitest';
import { Path, angleBetween } from '../src/anim/path';

describe('Path', () => {
  const path = new Path([
    { x: 0, z: 0 },
    { x: 0, z: 4 },
    { x: 3, z: 4 },
  ]);

  it('measures its length', () => {
    expect(path.length).toBeCloseTo(7);
  });

  it('follows the segments exactly', () => {
    expect(path.at(2)).toMatchObject({ x: 0, z: 2 });
    expect(path.at(5.5)).toMatchObject({ x: 1.5, z: 4 });
    expect(path.atFraction(1)).toMatchObject({ x: 3, z: 4 });
    expect(path.at(-1)).toMatchObject({ x: 0, z: 0 });
  });

  it('faces the direction of travel away from corners', () => {
    expect(path.at(1).heading).toBeCloseTo(0);
    expect(path.at(6).heading).toBeCloseTo(Math.PI / 2);
  });

  it('turns smoothly through a corner', () => {
    const before = path.at(4 - 0.15).heading;
    const at = path.at(4).heading;
    const after = path.at(4 + 0.15).heading;
    expect(at).toBeCloseTo(Math.PI / 4);
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(at);
    expect(after).toBeGreaterThan(at);
    expect(after).toBeLessThan(Math.PI / 2);
  });

  it('reverses', () => {
    const back = path.reversed();
    expect(back.at(0)).toMatchObject({ x: 3, z: 4 });
    expect(back.at(1).heading).toBeCloseTo(-Math.PI / 2);
  });

  it('takes the short way between angles', () => {
    expect(angleBetween(Math.PI * 0.9, -Math.PI * 0.9)).toBeCloseTo(Math.PI * 0.2);
  });
});
