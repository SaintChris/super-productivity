import typia from 'typia';
import { isTodayWithOffset } from '../../util/is-today.util';
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
  if (result.success) {
    return { ok: true };
  }
  return {
    ok: false,
    errors: result.errors.map((e) => ({ path: e.path, expected: e.expected })),
  };
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
