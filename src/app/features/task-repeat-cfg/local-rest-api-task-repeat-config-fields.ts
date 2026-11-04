import typia from 'typia';

/**
 * Only these fields may be set on a task-repeat-cfg via the REST API. Deliberately
 * excludes every recurrence-computation field (repeatCycle, weekday flags,
 * monthlyWeekOfMonth/monthlyWeekday/monthlyLastDay, startDate, repeatEvery) —
 * those are mutually interdependent (e.g. the monthly anchor fields are
 * mutually exclusive with each other) and feed date-calculation code the repo's
 * own AGENTS.md flags as high-risk to get wrong. This keeps the REST surface to
 * independent scalars only: renaming, pausing, notes, and estimate.
 */
const ALLOWED_TASK_REPEAT_CFG_FIELDS = new Set<string>([
  'title',
  'notes',
  'isPaused',
  'defaultEstimate',
]);

interface WritableTaskRepeatCfgFields {
  title?: string | null;
  notes?: string;
  isPaused?: boolean;
  defaultEstimate?: number;
}

type FieldTypeError = { path: string; expected: string };

export const pickAllowedTaskRepeatCfgFields = (
  body: Record<string, unknown>,
): Partial<WritableTaskRepeatCfgFields> => {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (ALLOWED_TASK_REPEAT_CFG_FIELDS.has(key)) {
      result[key] = body[key];
    }
  }
  return result as Partial<WritableTaskRepeatCfgFields>;
};

export const validateWritableTaskRepeatCfgFields = (
  fields: Partial<WritableTaskRepeatCfgFields>,
): { ok: true } | { ok: false; errors: FieldTypeError[] } => {
  const result = typia.validate<WritableTaskRepeatCfgFields>(fields);
  if (result.success) {
    return { ok: true };
  }
  return {
    ok: false,
    errors: result.errors.map((e) => ({ path: e.path, expected: e.expected })),
  };
};
