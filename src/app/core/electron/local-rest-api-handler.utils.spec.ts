import { parseAddTimeSpentBody } from './local-rest-api-handler.utils';

describe('parseAddTimeSpentBody', () => {
  it('accepts a valid date and positive integer duration', () => {
    expect(parseAddTimeSpentBody({ date: '2026-09-28', duration: 60000 })).toEqual({
      date: '2026-09-28',
      duration: 60000,
    });
  });

  it('rejects malformed dates', () => {
    expect('error' in parseAddTimeSpentBody({ date: '28-09-2026', duration: 1 })).toBe(
      true,
    );
    expect('error' in parseAddTimeSpentBody({ date: '2026-13-45', duration: 1 })).toBe(
      true,
    );
  });

  it('rejects non-positive, fractional or oversized durations', () => {
    for (const duration of [0, -5, 1.5, 86400001, '60000']) {
      expect('error' in parseAddTimeSpentBody({ date: '2026-09-28', duration })).toBe(
        true,
      );
    }
  });

  it('rejects non-object bodies', () => {
    expect('error' in parseAddTimeSpentBody(null)).toBe(true);
    expect('error' in parseAddTimeSpentBody([])).toBe(true);
  });
});
