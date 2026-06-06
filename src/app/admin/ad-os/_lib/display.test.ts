import { describe, expect, it } from 'vitest';
import {
  actionTone,
  auditTone,
  fmtWon,
  inventoryTone,
  pct,
  queueTone,
  readinessTone,
} from './display';

describe('ad-os display helpers', () => {
  it('formats Korean won using the existing compact admin convention', () => {
    expect(fmtWon(0)).toBe('0원');
    expect(fmtWon(9999)).toBe('9,999원');
    expect(fmtWon(10000)).toBe('1만원');
    expect(fmtWon(123456)).toBe('12만원');
  });

  it('keeps percent formatting zero-safe', () => {
    expect(pct(1, 0)).toBe('0%');
    expect(pct(1, 4)).toBe('25%');
    expect(pct(2, 3)).toBe('67%');
  });

  it('maps queue statuses to stable tones', () => {
    expect(queueTone('succeeded')).toBe('good');
    expect(queueTone('uploaded')).toBe('good');
    expect(queueTone('blocked')).toBe('bad');
    expect(queueTone('failed')).toBe('bad');
    expect(queueTone('approved')).toBe('warn');
    expect(queueTone('running')).toBe('warn');
    expect(queueTone('candidate')).toBe('neutral');
  });

  it('maps audit and readiness statuses without changing safety semantics', () => {
    expect(readinessTone('pass')).toBe('good');
    expect(readinessTone('partial')).toBe('warn');
    expect(readinessTone('fail')).toBe('bad');

    expect(auditTone('pass')).toBe('good');
    expect(auditTone('warn')).toBe('warn');
    expect(auditTone('fail')).toBe('bad');

    expect(inventoryTone('operational')).toBe('good');
    expect(inventoryTone('partial')).toBe('warn');
    expect(inventoryTone('blocked')).toBe('bad');
    expect(inventoryTone()).toBe('neutral');
  });

  it('passes action tone through unchanged for launch queue safety labels', () => {
    expect(actionTone('good')).toBe('good');
    expect(actionTone('warn')).toBe('warn');
    expect(actionTone('bad')).toBe('bad');
    expect(actionTone('neutral')).toBe('neutral');
  });
});
