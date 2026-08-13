import { describe, expect, it } from 'vitest';
import { getCapacityState } from './capacity-battery';

describe('getCapacityState', () => {
  it.each([
    [0, 40, 'healthy'],
    [24, 40, 'healthy'],
    [25, 40, 'busy'],
    [35, 40, 'warning'],
    [40, 40, 'full'],
    [1, 0, 'unavailable'],
  ] as const)('classifies %i of %i as %s', (current, maximum, expected) => {
    expect(getCapacityState(current, maximum)).toBe(expected);
  });
});
