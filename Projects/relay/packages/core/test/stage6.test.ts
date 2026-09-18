import { describe, it, expect } from 'vitest';
import { classifyBreach, parseControlBands } from '../src/stage6.js';

describe('classifyBreach', () => {
  const band = { centerline: 3600, sigma: 1800 };

  it('classifies a value within 1 sigma of the centerline as no breach', () => {
    expect(classifyBreach(4500, band)).toBe('none'); // 900/1800 = 0.5σ
  });

  it('classifies exactly 1 sigma away as the 1-sigma zone', () => {
    expect(classifyBreach(5400, band)).toBe('1sigma'); // 1800/1800 = 1.0σ
  });

  it('classifies exactly 2 sigma away as the 2-sigma zone', () => {
    expect(classifyBreach(7200, band)).toBe('2sigma'); // 3600/1800 = 2.0σ
  });

  it('classifies 3 or more sigma away as the 3-sigma zone', () => {
    expect(classifyBreach(9000, band)).toBe('3sigma'); // 5400/1800 = 3.0σ
    expect(classifyBreach(100000, band)).toBe('3sigma');
  });

  it('classifies a value BELOW the centerline the same way, by absolute deviation', () => {
    expect(classifyBreach(0, band)).toBe('2sigma'); // |0-3600|/1800 = 2.0σ
  });
});

describe('parseControlBands', () => {
  it('parses a valid bands config', () => {
    const yaml = 'gateLatencyS:\n  plan:\n    centerline: 3600\n    sigma: 1800\n';
    const bands = parseControlBands(yaml);
    expect(bands.gateLatencyS.plan).toEqual({ centerline: 3600, sigma: 1800 });
  });

  it('defaults to an empty gateLatencyS when the config has none configured', () => {
    const bands = parseControlBands('gateLatencyS: {}\n');
    expect(bands.gateLatencyS).toEqual({});
  });

  it('rejects a non-positive sigma — a zero or negative sigma makes every value infinitely many "sigmas" away', () => {
    const yaml = 'gateLatencyS:\n  plan:\n    centerline: 3600\n    sigma: 0\n';
    expect(() => parseControlBands(yaml)).toThrow();
  });
});
