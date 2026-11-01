import { InjectionToken } from '@angular/core';

/**
 * Helpers the task routes use without growing TaskService, which is already
 * over the size cap. Provided from main.ts. The overdue check is not here:
 * `?overdue=true` calls `isTaskOverdue` on the task route module.
 */
export interface LocalRestApiFeatureBridge {
  /** Web link to the issue a task was imported from; '' when there is none. */
  issueLink(
    issueType: string,
    issueId: string | number,
    issueProviderId: string,
  ): Promise<string>;

  /** Adds a subtask whose title is kept as is (no short syntax); returns its id. */
  addLiteralSubTask(parentId: string, fields: object): string;

  /**
   * Adds time spent on `date` (YYYY-MM-DD) the way the app's own tracking
   * does, so `timeSpentOnDay`, the parent roll-up and sync stay consistent.
   * A past day is back-filled: no work start/end and no auto-plan for today.
   */
  addTimeSpentOnDay(task: object, durationMs: number, date: string): void;
}

export const LOCAL_REST_API_FEATURE_BRIDGE =
  new InjectionToken<LocalRestApiFeatureBridge>('LOCAL_REST_API_FEATURE_BRIDGE');
