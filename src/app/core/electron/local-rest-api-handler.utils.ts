import typia from 'typia';
import { isTodayWithOffset } from '../../util/is-today.util';
import { isValidDBDateStr } from '../../util/get-db-date-str';
import { LocalRestApiResponsePayload } from '../../../../electron/shared-with-frontend/local-rest-api.model';

/**
 * Structural stand-ins for `Task` fields this file touches. Kept local
 * instead of importing `Task` from `features/tasks/task.model` because this
 * file lives under `core/`, and `core` must not import from `features`
 * (layer-boundary lint rule) — the service that DOES import `Task` passes
 * real `Task` values in here; structural typing accepts them without a
 * feature-layer import.
 */
type PickableTaskFields = Record<string, unknown>;

interface DueDatedTask {
  dueWithTime?: number | null;
  dueDay?: string | null;
}

/**
 * Pure REST-API-handler helpers (field allow-lists, value validation,
 * response shaping) split out of `LocalRestApiHandlerService` — see the repo
 * service size cap (`**\/*.service.ts` capped at 1200 lines). Nothing here
 * touches Angular DI or the store; it's all plain input→output logic.
 */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Only these fields may be set via the REST API to prevent state corruption. */
export const ALLOWED_TASK_FIELDS = new Set<string>([
  'title',
  'notes',
  'isDone',
  'timeEstimate',
  'timeSpent',
  'projectId',
  'tagIds',
  'dueDay',
  'dueWithTime',
  'plannedAt',
  'deadlineDay',
  'deadlineWithTime',
  'deadlineRemindAt',
]);

/**
 * Relational fields that callers often try to set but must be rejected:
 * mutating them as plain values corrupts invariants (parent<->child links,
 * projectId inheritance, tag-ordering lists). Subtask creation is available
 * via `POST /tasks` with `parentId` — see `_handleCreateTask`.
 */
export const REJECTED_TASK_FIELDS = ['parentId', 'subTaskIds'] as const;

/**
 * Fields a subtask inherits from its parent at the reducer (`addSubTask`
 * forces `tagIds: []` and `projectId = parent.projectId`). Reject them on
 * subtask create so callers don't get a 201 with values different from what
 * they sent.
 */
export const SUBTASK_INHERITED_FIELDS = ['projectId', 'tagIds'] as const;

export const pickAllowedFields = (body: Record<string, unknown>): PickableTaskFields => {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (ALLOWED_TASK_FIELDS.has(key)) {
      result[key] = body[key];
    }
  }
  return result;
};

/**
 * Value-level types for the fields writable via the REST API. Keys mirror
 * ALLOWED_TASK_FIELDS; `pickAllowedFields` filters by key only, so this is
 * where the *values* get checked. Without it a caller could push a wrong-typed
 * value (e.g. `tagIds: 123`, `timeEstimate: 'abc'`) straight into the store and
 * the synced op-log, where it corrupts state locally and trips typia-as-corrupt
 * on other devices when the op replays.
 */
export interface WritableTaskFields {
  title?: string;
  notes?: string;
  isDone?: boolean;
  timeEstimate?: number;
  timeSpent?: number;
  projectId?: string;
  tagIds?: string[];
  dueDay?: string | null;
  dueWithTime?: number | null;
  plannedAt?: number;
  deadlineDay?: string | null;
  deadlineWithTime?: number | null;
  deadlineRemindAt?: number | null;
}

export type FieldTypeError = { path: string; expected: string };

/**
 * Validates the value types of already-key-filtered task fields. The create
 * path is separately guarded by `typia.assert<Task>` in the task service (a
 * bad value throws → generic 500); validating here lets both create and PATCH
 * reject bad input with a clean 400 before anything is dispatched.
 */
export const validateWritableFields = (
  fields: PickableTaskFields,
): { ok: true } | { ok: false; errors: FieldTypeError[] } => {
  const result = typia.validate<WritableTaskFields>(fields);
  if (!result.success) {
    return {
      ok: false,
      errors: result.errors.map((e) => ({ path: e.path, expected: e.expected })),
    };
  }
  // typia checks the TYPE of deadlineDay (string), not its FORMAT. An
  // out-of-shape day string reaches the store and corrupts date maths there,
  // so the format is checked separately — same guard upstream applies inline.
  if (typeof fields.deadlineDay === 'string' && !isValidDBDateStr(fields.deadlineDay)) {
    return {
      ok: false,
      errors: [{ path: '$input.deadlineDay', expected: 'YYYY-MM-DD' }],
    };
  }
  if (typeof fields.dueDay === 'string' && !isValidDBDateStr(fields.dueDay)) {
    return {
      ok: false,
      errors: [{ path: '$input.dueDay', expected: 'YYYY-MM-DD' }],
    };
  }
  return { ok: true };
};

export const firstRejectedField = (body: Record<string, unknown>): string | undefined =>
  REJECTED_TASK_FIELDS.find((field) => field in body);

/** Only these fields may be set on a project via the REST API — see ALLOWED_TASK_FIELDS. */
export const ALLOWED_PROJECT_FIELDS = new Set<string>(['title', 'icon']);

export interface WritableProjectFields {
  title?: string;
  icon?: string | null;
}

export const pickAllowedProjectFields = (
  body: Record<string, unknown>,
): Partial<WritableProjectFields> => {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (ALLOWED_PROJECT_FIELDS.has(key)) {
      result[key] = body[key];
    }
  }
  return result as Partial<WritableProjectFields>;
};

export const validateWritableProjectFields = (
  fields: Partial<WritableProjectFields>,
): { ok: true } | { ok: false; errors: FieldTypeError[] } => {
  const result = typia.validate<WritableProjectFields>(fields);
  if (result.success) {
    return { ok: true };
  }
  return {
    ok: false,
    errors: result.errors.map((e) => ({ path: e.path, expected: e.expected })),
  };
};

/** Only these fields may be set on a tag via the REST API — see ALLOWED_TASK_FIELDS. */
export const ALLOWED_TAG_FIELDS = new Set<string>(['title', 'icon']);

export interface WritableTagFields {
  title?: string;
  icon?: string | null;
}

export const pickAllowedTagFields = (
  body: Record<string, unknown>,
): Partial<WritableTagFields> => {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (ALLOWED_TAG_FIELDS.has(key)) {
      result[key] = body[key];
    }
  }
  return result as Partial<WritableTagFields>;
};

export const validateWritableTagFields = (
  fields: Partial<WritableTagFields>,
): { ok: true } | { ok: false; errors: FieldTypeError[] } => {
  const result = typia.validate<WritableTagFields>(fields);
  if (result.success) {
    return { ok: true };
  }
  return {
    ok: false,
    errors: result.errors.map((e) => ({ path: e.path, expected: e.expected })),
  };
};

/** Only these fields may be set on a note via the REST API — see ALLOWED_TASK_FIELDS. */
export const ALLOWED_NOTE_FIELDS = new Set<string>([
  'content',
  'projectId',
  'isPinnedToToday',
]);

export interface WritableNoteFields {
  content?: string;
  projectId?: string | null;
  isPinnedToToday?: boolean;
}

export const pickAllowedNoteFields = (
  body: Record<string, unknown>,
): Partial<WritableNoteFields> => {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (ALLOWED_NOTE_FIELDS.has(key)) {
      result[key] = body[key];
    }
  }
  return result as Partial<WritableNoteFields>;
};

export const validateWritableNoteFields = (
  fields: Partial<WritableNoteFields>,
): { ok: true } | { ok: false; errors: FieldTypeError[] } => {
  const result = typia.validate<WritableNoteFields>(fields);
  if (result.success) {
    return { ok: true };
  }
  return {
    ok: false,
    errors: result.errors.map((e) => ({ path: e.path, expected: e.expected })),
  };
};

/**
 * Only these fields may be set on a task-repeat-cfg via the REST API. Deliberately
 * excludes every recurrence-computation field (repeatCycle, weekday flags,
 * monthlyWeekOfMonth/monthlyWeekday/monthlyLastDay, startDate, repeatEvery) —
 * those are mutually interdependent (e.g. the monthly anchor fields are
 * mutually exclusive with each other) and feed date-calculation code the repo's
 * own AGENTS.md flags as high-risk to get wrong. This keeps the REST surface to
 * independent scalars only: renaming, pausing, notes, and estimate.
 */
export const ALLOWED_TASK_REPEAT_CFG_FIELDS = new Set<string>([
  'title',
  'notes',
  'isPaused',
  'defaultEstimate',
]);

export interface WritableTaskRepeatCfgFields {
  title?: string | null;
  notes?: string;
  isPaused?: boolean;
  defaultEstimate?: number;
}

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

export const getQueryParam = (
  query: Record<string, string | string[]>,
  key: string,
): string | undefined => {
  const value = query[key];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
};

export const getQueryParamAsBoolean = (
  query: Record<string, string | string[]>,
  key: string,
  defaultValue: boolean,
): boolean => {
  const value = getQueryParam(query, key);
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
};

export const createErrorResponse = (
  requestId: string,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): LocalRestApiResponsePayload => ({
  requestId,
  status,
  body: {
    ok: false,
    error: {
      code,
      message,
      details,
    },
  },
});

export const createSuccessResponse = (
  requestId: string,
  status: number,
  data: unknown,
): LocalRestApiResponsePayload => ({
  requestId,
  status,
  body: {
    ok: true,
    data,
  },
});

export type TaskSource = 'active' | 'archived' | 'all';

export const isValidTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && new Date(value).getTime() > 0;

export const isTaskInToday = (
  task: DueDatedTask,
  todayStr: string,
  startOfNextDayDiffMs: number,
): boolean => {
  if (isValidTimestamp(task.dueWithTime)) {
    return isTodayWithOffset(task.dueWithTime, todayStr, startOfNextDayDiffMs);
  }
  return task.dueDay === todayStr;
};

/**
 * Structural stand-in for the deadline fields of `Task`. Same reason as
 * `DueDatedTask` above: this file lives under `core/` and must not import
 * from `features/`, so the caller passes a real `Task` and structural typing
 * accepts it.
 */
export interface DeadlineTask {
  deadlineDay?: string | null;
  deadlineWithTime?: number | null;
  deadlineRemindAt?: number | null;
}

export const DEADLINE_FIELDS = [
  'deadlineDay',
  'deadlineWithTime',
  'deadlineRemindAt',
] as const;

export type DeadlineChange =
  | {
      type: 'set';
      fields: {
        deadlineDay?: string;
        deadlineWithTime?: number;
        deadlineRemindAt?: number;
      };
    }
  | { type: 'clearReminder' }
  | { type: 'remove' };

export const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export const validateDeadlineFields = (
  fields: Partial<WritableTaskFields>,
): string | undefined => {
  if (fields.deadlineDay != null && fields.deadlineWithTime != null) {
    return 'deadlineDay and deadlineWithTime cannot both be set';
  }
  if (typeof fields.deadlineDay === 'string' && !isValidDBDateStr(fields.deadlineDay)) {
    return 'deadlineDay must be a valid YYYY-MM-DD date';
  }
  if (fields.deadlineWithTime != null && fields.deadlineWithTime <= 0) {
    return 'deadlineWithTime must be a positive timestamp';
  }
  if (fields.deadlineRemindAt != null && fields.deadlineRemindAt <= 0) {
    return 'deadlineRemindAt must be a positive timestamp';
  }
  return undefined;
};

/**
 * Resolves which deadline day/time the request results in, before reminders
 * are considered. An omitted field carries the task's current value over; a
 * newly supplied deadline type replaces the other type, matching the
 * mutual-exclusivity behavior of the deadline meta-reducer.
 */
export const resolveDeadlineValue = (
  fields: Partial<WritableTaskFields>,
  existingTask?: DeadlineTask,
): { deadlineDay?: string; deadlineWithTime?: number } => {
  const hasDay = hasOwn(fields, 'deadlineDay');
  const hasTime = hasOwn(fields, 'deadlineWithTime');
  const requestedDay = fields.deadlineDay ?? undefined;
  const requestedTime = fields.deadlineWithTime ?? undefined;
  let deadlineDay = hasDay ? requestedDay : (existingTask?.deadlineDay ?? undefined);
  let deadlineWithTime = hasTime
    ? requestedTime
    : (existingTask?.deadlineWithTime ?? undefined);
  if (requestedDay !== undefined) deadlineWithTime = undefined;
  if (requestedTime !== undefined) deadlineDay = undefined;
  return { deadlineDay, deadlineWithTime };
};

/**
 * Resolves what happens to the reminder once the resulting deadline is known.
 * A supplied value wins; a changed deadline without one clears the old
 * reminder, just like the UI's setDeadline action; an otherwise unchanged
 * deadline keeps its reminder. An explicit null that would otherwise keep an
 * existing reminder becomes 'clear' so only the reminder is touched, without
 * re-planning the deadline.
 *
 * Takes the *normalized* existing reminder (see `resolveDeadlineChange`): a
 * stored `null` means "no reminder", so it must neither be carried over into
 * `setDeadline` nor turn a `{"deadlineRemindAt": null}` no-op into a
 * `clearDeadlineReminder` op.
 */
export const resolveReminderChange = (
  fields: Partial<WritableTaskFields>,
  existingDeadlineRemindAt: number | undefined,
  isDeadlineValueChanged: boolean,
): { type: 'clear' } | { type: 'value'; remindAt: number | undefined } => {
  if (!hasOwn(fields, 'deadlineRemindAt')) {
    return {
      type: 'value',
      remindAt: isDeadlineValueChanged ? undefined : existingDeadlineRemindAt,
    };
  }
  const requested = fields.deadlineRemindAt ?? undefined;
  if (
    requested === undefined &&
    !isDeadlineValueChanged &&
    existingDeadlineRemindAt !== undefined
  ) {
    return { type: 'clear' };
  }
  return { type: 'value', remindAt: requested };
};

export const resolveDeadlineChange = (
  fields: Partial<WritableTaskFields>,
  existingTask?: DeadlineTask,
): { ok: true; change?: DeadlineChange } | { ok: false; message: string } => {
  const hasDay = hasOwn(fields, 'deadlineDay');
  const hasTime = hasOwn(fields, 'deadlineWithTime');
  const hasReminder = hasOwn(fields, 'deadlineRemindAt');
  if (!hasDay && !hasTime && !hasReminder) {
    return { ok: true };
  }

  const { deadlineDay, deadlineWithTime } = resolveDeadlineValue(fields, existingTask);

  if (deadlineDay === undefined && deadlineWithTime === undefined) {
    if (fields.deadlineRemindAt != null) {
      return { ok: false, message: 'deadlineRemindAt requires a deadline' };
    }
    const hasExistingDeadline = Boolean(
      existingTask?.deadlineDay ||
      existingTask?.deadlineWithTime ||
      existingTask?.deadlineRemindAt,
    );
    return {
      ok: true,
      change: hasExistingDeadline && (hasDay || hasTime) ? { type: 'remove' } : undefined,
    };
  }

  const existingDeadlineDay = existingTask?.deadlineDay ?? undefined;
  const existingDeadlineWithTime = existingTask?.deadlineWithTime ?? undefined;
  const existingDeadlineRemindAt = existingTask?.deadlineRemindAt ?? undefined;
  const isDeadlineValueChanged =
    deadlineDay !== existingDeadlineDay || deadlineWithTime !== existingDeadlineWithTime;

  const reminder = resolveReminderChange(
    fields,
    existingDeadlineRemindAt,
    isDeadlineValueChanged,
  );
  if (reminder.type === 'clear') {
    return { ok: true, change: { type: 'clearReminder' } };
  }
  const deadlineRemindAt = reminder.remindAt;

  if (
    existingTask &&
    deadlineDay === existingDeadlineDay &&
    deadlineWithTime === existingDeadlineWithTime &&
    deadlineRemindAt === existingDeadlineRemindAt
  ) {
    return { ok: true };
  }

  return {
    ok: true,
    change: {
      type: 'set',
      fields: {
        ...(deadlineDay !== undefined ? { deadlineDay } : {}),
        ...(deadlineWithTime !== undefined ? { deadlineWithTime } : {}),
        ...(deadlineRemindAt !== undefined ? { deadlineRemindAt } : {}),
      },
    },
  };
};

const MAX_ADD_TIME_MS = 24 * 60 * 60 * 1000;

/**
 * Validates `POST /tasks/:id/time` bodies: `{ date: 'YYYY-MM-DD', duration: ms }`.
 * Returns the parsed values, or an error message for a 400 response.
 */
export const parseAddTimeSpentBody = (
  body: unknown,
): { date: string; duration: number } | { error: string } => {
  if (!isRecord(body)) {
    return { error: 'Body must be an object with date and duration' };
  }
  const { date, duration } = body;
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(`${date}T00:00:00Z`))
  ) {
    return { error: 'date must be a valid YYYY-MM-DD string' };
  }
  if (
    typeof duration !== 'number' ||
    !Number.isInteger(duration) ||
    duration <= 0 ||
    duration > MAX_ADD_TIME_MS
  ) {
    return { error: 'duration must be a positive integer of milliseconds, at most 24h' };
  }
  return { date, duration };
};
