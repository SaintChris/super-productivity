import {
  parseAddTimeSpentBody,
  readIsIgnoreShortSyntax,
} from './local-rest-api-handler.utils';

describe('parseAddTimeSpentBody', () => {
  const TODAY = '2026-09-30';

  it('accepts a valid date and positive integer duration', () => {
    expect(parseAddTimeSpentBody({ date: '2026-09-28', duration: 60000 }, TODAY)).toEqual(
      { date: '2026-09-28', duration: 60000 },
    );
  });

  it('accepts today', () => {
    expect(parseAddTimeSpentBody({ date: TODAY, duration: 1 }, TODAY)).toEqual({
      date: TODAY,
      duration: 1,
    });
  });

  it('rejects malformed dates', () => {
    for (const date of ['28-09-2026', '2026-13-45', '2026-02-30', 20260928]) {
      expect(parseAddTimeSpentBody({ date, duration: 1 }, TODAY)).toEqual(
        jasmine.objectContaining({ code: 'INVALID_INPUT' }),
      );
    }
  });

  it('rejects dates after the logical today', () => {
    expect(parseAddTimeSpentBody({ date: '2026-10-01', duration: 1 }, TODAY)).toEqual(
      jasmine.objectContaining({ code: 'INVALID_INPUT' }),
    );
  });

  it('rejects non-positive, fractional or oversized durations', () => {
    for (const duration of [0, -5, 1.5, 86400001, '60000']) {
      expect(parseAddTimeSpentBody({ date: '2026-09-28', duration }, TODAY)).toEqual(
        jasmine.objectContaining({ code: 'INVALID_INPUT' }),
      );
    }
  });

  it('rejects unknown body fields', () => {
    expect(
      parseAddTimeSpentBody({ date: '2026-09-28', duration: 1, note: 'x' }, TODAY),
    ).toEqual(jasmine.objectContaining({ code: 'UNSUPPORTED_FIELD' }));
  });

  it('rejects non-object bodies', () => {
    expect('error' in parseAddTimeSpentBody(null, TODAY)).toBe(true);
    expect('error' in parseAddTimeSpentBody([], TODAY)).toBe(true);
  });
});

describe('readIsIgnoreShortSyntax', () => {
  it('defaults to literal titles when absent', () => {
    expect(readIsIgnoreShortSyntax({})).toEqual({ ok: true, value: true });
  });

  it('returns true when true', () => {
    expect(readIsIgnoreShortSyntax({ isIgnoreShortSyntax: true })).toEqual({
      ok: true,
      value: true,
    });
  });

  it('returns false when explicitly false', () => {
    expect(readIsIgnoreShortSyntax({ isIgnoreShortSyntax: false })).toEqual({
      ok: true,
      value: false,
    });
  });

  it('rejects non-boolean values', () => {
    for (const v of ['yes', 1, null]) {
      expect(readIsIgnoreShortSyntax({ isIgnoreShortSyntax: v }).ok).toBe(false);
    }
  });
});
