import { describe, expect, it } from 'vitest';
import { durationSeconds, formatDuration } from './duration';

describe('formatDuration', () => {
  it('shows minutes and seconds under an hour', () => {
    expect(formatDuration('PT27M13S')).toBe('27:13');
    expect(formatDuration('PT45S')).toBe('0:45');
    expect(formatDuration('PT5M')).toBe('5:00');
    expect(formatDuration('PT59M59S')).toBe('59:59');
  });

  it('adds hours from an hour up, padding the rest', () => {
    expect(formatDuration('PT1H2M3S')).toBe('1:02:03');
    expect(formatDuration('PT3H')).toBe('3:00:00');
    expect(formatDuration('PT1H')).toBe('1:00:00');
  });

  it('counts days as 24 hours', () => {
    expect(formatDuration('P1DT2H')).toBe('26:00:00');
  });

  it('gives null when there is no length to show', () => {
    for (const value of [undefined, null, '', 'P0D', 'PT0S', 'PT', '27:13', 'PT1.5S']) expect(formatDuration(value)).toBeNull();
  });
});

describe('durationSeconds', () => {
  it('adds up the parts', () => {
    expect(durationSeconds('PT1H2M3S')).toBe(3723);
    expect(durationSeconds('P1DT1S')).toBe(86401);
  });
});
