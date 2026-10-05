import { describe, expect, it } from 'vitest';
import { WEATHER_SHARE, colorOf, materials, weatheredColor } from '../src/scene/materials';

describe('weathered materials', () => {
  it('move a past block 35% of the way to slateLight, at roughness 1 (spec 5.7)', () => {
    expect(WEATHER_SHARE).toBe(0.35);
    const navy = colorOf('navy');
    const pale = colorOf('slateLight');
    const weathered = weatheredColor('navy');
    for (const channel of ['r', 'g', 'b'] as const) {
      expect(weathered[channel]).toBeCloseTo(navy[channel] + (pale[channel] - navy[channel]) * 0.35, 6);
    }
    const material = materials.blockWeathered('navy');
    expect(material.roughness).toBe(1);
    expect(material.color.equals(weathered)).toBe(true);
  });

  it('share one weathered material per category and look', () => {
    expect(materials.blockWeathered('blue')).toBe(materials.blockWeathered('blue'));
    expect(materials.blockWeathered('blue', 'dimmed')).not.toBe(materials.blockWeathered('blue'));
    expect(materials.blockWeathered('blue', 'dimmed').transparent).toBe(true);
  });

  it('give the now ring a blue glow at 0.6 (spec 5.7)', () => {
    const ring = materials.nowRing();
    expect(ring.color.equals(colorOf('blue'))).toBe(true);
    expect(ring.emissive.equals(colorOf('blue'))).toBe(true);
    expect(ring.emissiveIntensity).toBe(0.6);
  });
});
