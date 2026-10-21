import { describe, expect, it } from 'vitest';
import { describeDuration, durationSeconds, formatDuration } from './duration';

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

describe('describeDuration', () => {
  it('uses seconds under a minute', () => {
    expect(describeDuration('PT45S')).toBe('45 sec');
    expect(describeDuration('PT59S')).toBe('59 sec');
    expect(describeDuration('PT1S')).toBe('1 sec');
  });

  it('rounds to the nearest minute from a minute up', () => {
    expect(describeDuration('PT1M')).toBe('1 min');
    expect(describeDuration('PT1M20S')).toBe('1 min');
    expect(describeDuration('PT1M30S')).toBe('2 min');
    expect(describeDuration('PT12M37S')).toBe('13 min');
    expect(describeDuration('PT12M29S')).toBe('12 min');
  });

  it('adds hours from an hour up, leaving out zero minutes', () => {
    expect(describeDuration('PT1H2M3S')).toBe('1 hr 2 min');
    expect(describeDuration('PT2H')).toBe('2 hr');
    expect(describeDuration('PT1H29S')).toBe('1 hr');
    expect(describeDuration('P1DT2H')).toBe('26 hr');
  });

  it('carries a rounded-up hour', () => {
    expect(describeDuration('PT59M40S')).toBe('1 hr');
    expect(describeDuration('PT1H59M40S')).toBe('2 hr');
  });

  it('gives null when there is no length to show', () => {
    for (const value of [undefined, null, '', 'P0D', 'PT0S', 'PT', '12:37']) expect(describeDuration(value)).toBeNull();
  });
});
