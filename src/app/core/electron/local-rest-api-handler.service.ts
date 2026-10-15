import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { TaskService } from '../../features/tasks/task.service';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { Task, TaskWithSubTasks } from '../../features/tasks/task.model';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { TaskArchiveService } from '../../features/archive/task-archive.service';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { ProjectService } from '../../features/project/project.service';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { TagService } from '../../features/tag/tag.service';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { TODAY_TAG } from '../../features/tag/tag.const';
import { DateService } from '../date/date.service';
import { IssueLog } from '../log';
import { LOCAL_REST_API_FEATURE_BRIDGE } from './local-rest-api-feature-bridge';
import { LOCAL_REST_API_FEATURE_ROUTES } from './local-rest-api-feature-routes';

import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { getDeadlineAutoPlanFields } from '../../features/tasks/util/get-deadline-auto-plan-fields';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import {
  selectCurrentCycle,
  selectIsBreakTimeUp,
  selectIsInOvertime,
  selectIsLongBreak,
  selectIsRunning,
  selectIsSessionCompleted,
  selectMode,
  selectTimeRemaining,
  selectTimer,
} from '../../features/focus-mode/store/focus-mode.selectors';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';
import {
  isRecord,
  DeadlineChange,
  resolveDeadlineChange,
  validateDeadlineFields,
  hasOwn,
  DEADLINE_FIELDS,
  WritableTaskFields,
  pickAllowedFields,
  validateWritableFields,
  firstRejectedField,
  SUBTASK_INHERITED_FIELDS,
  pickAllowedProjectFields,
  validateWritableProjectFields,
  pickAllowedTagFields,
  validateWritableTagFields,
  getQueryParam,
  getQueryParamAsBoolean,
  createErrorResponse,
  createSuccessResponse,
  TaskSource,
  isTaskInToday,
  parseAddTimeSpentBody,
  readIsIgnoreShortSyntax,
  isIncluded,
  ISSUE_URL_TIMEOUT_MS,
} from './local-rest-api-handler.utils';

@Injectable({
  providedIn: 'root',
})
export class LocalRestApiHandlerService {
  private readonly _taskService = inject(TaskService);
  private readonly _taskArchiveService = inject(TaskArchiveService);
  private readonly _projectService = inject(ProjectService);
  private readonly _tagService = inject(TagService);
  private readonly _dateService = inject(DateService);
  private readonly _featureBridge = inject(LOCAL_REST_API_FEATURE_BRIDGE);
  private readonly _featureRoutes =
    inject(LOCAL_REST_API_FEATURE_ROUTES, { optional: true }) ?? [];
  private readonly _store = inject(Store);
  private _isInitialized = false;

  private _dispatchDeadlineChange(taskId: string, change: DeadlineChange): void {
    if (change.type === 'clearReminder') {
      this._store.dispatch(TaskSharedActions.clearDeadlineReminder({ taskId }));
      return;
    }

    if (change.type === 'remove') {
      this._store.dispatch(
        TaskSharedActions.removeDeadline({ taskId, isSkipSnack: true }),
      );
      return;
    }

    this._store.dispatch(
      TaskSharedActions.setDeadline({
        taskId,
        ...change.fields,
        ...getDeadlineAutoPlanFields(
          this._dateService,
          change.fields.deadlineDay,
          change.fields.deadlineWithTime,
        ),
        isSkipSnack: true,
      }),
    );
  }

  init(): void {
    if (this._isInitialized || !window.ea?.onLocalRestApiRequest) {
      return;
    }
    this._isInitialized = true;

    window.ea.onLocalRestApiRequest((payload) => {
      void this._handleRequest(payload);
    });
  }

  private async _handleRequest(payload: LocalRestApiRequestPayload): Promise<void> {
    let response: LocalRestApiResponsePayload;

    try {
      response = await this._routeRequest(payload);
    } catch (error) {
      response = createErrorResponse(
        payload.requestId,
        500,
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Unknown internal error',
      );
    }

    window.ea.sendLocalRestApiResponse(response);
  }

  private async _routeRequest(
    payload: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload> {
    const { method, path, requestId, body, query } = payload;
    const segments = path.split('/').filter(Boolean);

    if (method === 'GET' && path === '/status') {
      return this._handleGetStatus(requestId);
    }

    if (method === 'GET' && path === '/focus') {
      return this._handleGetFocus(requestId);
    }

    if (method === 'GET' && path === '/task-control/current') {
      return this._handleGetCurrentTask(requestId);
    }

    if (method === 'POST' && path === '/task-control/stop') {
      return this._handleStopTask(requestId);
    }

    if (method === 'POST' && path === '/task-control/current') {
      return this._handleSetCurrentTask(requestId, body);
    }

    if (method === 'GET' && path === '/tasks') {
      return this._handleListTasks(requestId, query);
    }

    if (method === 'POST' && path === '/tasks') {
      return this._handleCreateTask(requestId, body);
    }

    if (segments[0] === 'tasks' && segments[1] && segments.length >= 2) {
      return this._handleTaskRoutes(method, segments, requestId, body, query);
    }

    if (method === 'GET' && path === '/projects') {
      return this._handleListProjects(requestId, query);
    }

    if (method === 'POST' && path === '/projects') {
      return this._handleCreateProject(requestId, body);
    }

    if (segments[0] === 'projects' && segments[1] && segments.length === 2) {
      if (method === 'DELETE') {
        return this._handleDeleteProject(requestId, segments[1]);
      }
      if (method === 'PATCH') {
        return this._handleUpdateProject(requestId, segments[1], body);
      }
    }

    if (method === 'GET' && path === '/tags') {
      return this._handleListTags(requestId, query);
    }

    if (method === 'POST' && path === '/tags') {
      return this._handleCreateTag(requestId, body);
    }

    if (segments[0] === 'tags' && segments[1] && segments.length === 2) {
      if (method === 'PATCH') {
        return this._handleUpdateTag(requestId, segments[1], body);
      }
      if (method === 'DELETE') {
        return this._handleDeleteTag(requestId, segments[1]);
      }
    }

    for (const routes of this._featureRoutes) {
      const response = await routes.handle(payload);
      if (response) {
        return response;
      }
    }

    return createErrorResponse(requestId, 404, 'NOT_FOUND', 'Route not found');
  }

  private async _handleGetStatus(
    requestId: string,
  ): Promise<LocalRestApiResponsePayload> {
    const [currentTask, allTasks] = await Promise.all([
      firstValueFrom(this._taskService.currentTask$),
      firstValueFrom(this._taskService.allTasks$),
    ]);

    return createSuccessResponse(requestId, 200, {
      currentTask,
      currentTaskId: currentTask?.id ?? null,
      taskCount: allTasks.length,
    });
  }

  private async _handleGetFocus(requestId: string): Promise<LocalRestApiResponsePayload> {
    const state = await firstValueFrom(this._store);
    const timer = selectTimer(state);
    const mode = selectMode(state);
    const cycle = selectCurrentCycle(state);
    const isRunning = selectIsRunning(state);
    const isBreakTimeUp = selectIsBreakTimeUp(state);
    const isLongBreak = selectIsLongBreak(state);
    const remainingMs = selectTimeRemaining(state);
    const isSessionDone = selectIsSessionCompleted(state);
    const isOvertime = selectIsInOvertime(state);

    return createSuccessResponse(requestId, 200, {
      mode,
      cycle,
      isSessionDone,
      timer:
        timer.purpose === null
          ? null
          : {
              purpose: timer.purpose,
              status: isRunning ? 'running' : isBreakTimeUp ? 'done' : 'paused',
              isOvertime,
              isLongBreak,
              elapsedMs: timer.elapsed,
              remainingMs,
              durationMs: timer.duration,
            },
    });
  }

  private async _handleGetCurrentTask(
    requestId: string,
  ): Promise<LocalRestApiResponsePayload> {
    const currentTask = await firstValueFrom(this._taskService.currentTask$);
    return createSuccessResponse(requestId, 200, currentTask);
  }

  private async _handleStopTask(requestId: string): Promise<LocalRestApiResponsePayload> {
    this._taskService.setCurrentId(null);
    return createSuccessResponse(requestId, 200, { currentTaskId: null });
  }

  private async _handleSetCurrentTask(
    requestId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    if (!isRecord(body)) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'Request body must be a JSON object with taskId',
      );
    }

    const taskId = body.taskId;

    if (taskId === null) {
      this._taskService.setCurrentId(null);
      return createSuccessResponse(requestId, 200, { currentTaskId: null });
    }

    if (typeof taskId !== 'string') {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'taskId must be a string or null',
      );
    }

    const task = await this._getTaskById(taskId);
    if (!task) {
      return createErrorResponse(requestId, 404, 'TASK_NOT_FOUND', 'Task not found');
    }

    this._taskService.setCurrentId(taskId);
    return createSuccessResponse(requestId, 200, { currentTaskId: taskId });
  }

  private async _handleListTasks(
    requestId: string,
    query: Record<string, string | string[]>,
  ): Promise<LocalRestApiResponsePayload> {
    const queryText = getQueryParam(query, 'query');
    const projectId = getQueryParam(query, 'projectId');
    const tagId = getQueryParam(query, 'tagId');
    const overdue = getQueryParamAsBoolean(query, 'overdue', false);
    const includeDone = getQueryParamAsBoolean(query, 'includeDone', false);
    const VALID_SOURCES: TaskSource[] = ['active', 'archived', 'all'];
    const rawSource = getQueryParam(query, 'source') || 'active';
    const source: TaskSource = VALID_SOURCES.includes(rawSource as TaskSource)
      ? (rawSource as TaskSource)
      : 'active';

    let tasks: Task[];

    if (source === 'archived') {
      const archive = await this._taskArchiveService.load();
      tasks = archive.ids.map((id) => archive.entities[id]).filter((t): t is Task => !!t);
    } else if (source === 'all') {
      tasks = await this._taskService.getAllTasksEverywhere();
    } else {
      tasks = await firstValueFrom(this._taskService.allTasks$);
    }

    let filtered = tasks;

    if (queryText) {
      const lowerQuery = queryText.toLowerCase();
      filtered = filtered.filter((t) => t.title.toLowerCase().includes(lowerQuery));
    }

    if (projectId) {
      filtered = filtered.filter((t) => t.projectId === projectId);
    }

    if (tagId === TODAY_TAG.id) {
      const todayStr = this._dateService.todayStr();
      const startOfNextDayDiffMs = this._dateService.getStartOfNextDayDiffMs();
      filtered = filtered.filter((t) => isTaskInToday(t, todayStr, startOfNextDayDiffMs));
    } else if (tagId) {
      filtered = filtered.filter((t) => t.tagIds.includes(tagId));
    }

    if (overdue) {
      const todayStr = this._dateService.todayStr();
      const startOfNextDayDiffMs = this._dateService.getStartOfNextDayDiffMs();
      filtered = filtered.filter((t) =>
        this._featureBridge.isTaskOverdue(t, todayStr, startOfNextDayDiffMs),
      );
    }

    if (!includeDone) {
      filtered = filtered.filter((t) => !t.isDone);
    }

    return createSuccessResponse(requestId, 200, filtered);
  }

  private async _handleCreateTask(
    requestId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    if (!isRecord(body) || typeof body.title !== 'string' || !body.title.trim()) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'Task title must be a non-empty string',
      );
    }

    if ('subTaskIds' in body) {
      return createErrorResponse(
        requestId,
        400,
        'UNSUPPORTED_FIELD',
        'subTaskIds cannot be set on task creation — create the parent first, then create each child with POST /tasks using parentId',
      );
    }

    const shortSyntaxFlag = readIsIgnoreShortSyntax(body);
    if (!shortSyntaxFlag.ok) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        shortSyntaxFlag.message,
      );
    }
    const isIgnoreShortSyntax = shortSyntaxFlag.value;

    const title = body.title.trim();
    const additionalFields = pickAllowedFields(body);

    const validation = validateWritableFields(additionalFields);
    if (!validation.ok) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'One or more task fields have an invalid type',
        validation.errors,
      );
    }

    const deadlineValidationError = validateDeadlineFields(additionalFields);
    if (deadlineValidationError) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        deadlineValidationError,
      );
    }

    const deadlineFields = Object.fromEntries(
      DEADLINE_FIELDS.filter((field) => hasOwn(additionalFields, field)).map((field) => [
        field,
        additionalFields[field],
      ]),
    ) as Partial<WritableTaskFields>;
    const deadlineResolution = resolveDeadlineChange(deadlineFields);
    if (!deadlineResolution.ok) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        deadlineResolution.message,
      );
    }
    for (const field of DEADLINE_FIELDS) {
      delete additionalFields[field];
    }

    if ('parentId' in body) {
      if (typeof body.parentId !== 'string' || !body.parentId) {
        return createErrorResponse(
          requestId,
          400,
          'INVALID_INPUT',
          'parentId must be a non-empty string',
        );
      }

      const inherited = SUBTASK_INHERITED_FIELDS.find((field) => field in body);
      if (inherited) {
        return createErrorResponse(
          requestId,
          400,
          'UNSUPPORTED_FIELD',
          `${inherited} cannot be set when creating a subtask — it's inherited from the parent`,
        );
      }

      const parent = await this._getTaskById(body.parentId);
      if (!parent) {
        return createErrorResponse(
          requestId,
          404,
          'PARENT_NOT_FOUND',
          `Parent task ${body.parentId} not found`,
        );
      }

      if (parent.parentId) {
        return createErrorResponse(
          requestId,
          400,
          'INVALID_PARENT',
          'Cannot nest subtasks: parent task is itself a subtask',
        );
      }

      const subTaskId = isIgnoreShortSyntax
        ? this._featureBridge.addLiteralSubTask(body.parentId, {
            title,
            ...additionalFields,
          })
        : this._taskService.addSubTaskTo(body.parentId, {
            title,
            ...additionalFields,
          });
      if (deadlineResolution.change?.type === 'set') {
        this._dispatchDeadlineChange(subTaskId, deadlineResolution.change);
      }
      const createdSubTask = await this._getTaskById(subTaskId);
      return createSuccessResponse(requestId, 201, createdSubTask);
    }

    const taskId = isIgnoreShortSyntax
      ? this._taskService.add(title, false, additionalFields, false, true)
      : this._taskService.add(title, false, additionalFields);
    if (deadlineResolution.change?.type === 'set') {
      this._dispatchDeadlineChange(taskId, deadlineResolution.change);
    }
    const createdTask = await this._getTaskById(taskId);

    return createSuccessResponse(requestId, 201, createdTask);
  }

  private async _handleTaskRoutes(
    method: string,
    segments: string[],
    requestId: string,
    body: unknown,
    query: Record<string, string | string[]>,
  ): Promise<LocalRestApiResponsePayload> {
    const taskId = segments[1];

    if (segments.length === 2) {
      if (method === 'GET') {
        const task = await this._getTaskById(taskId);
        if (!task) {
          return createErrorResponse(requestId, 404, 'TASK_NOT_FOUND', 'Task not found');
        }
        // Opt-in: some providers fetch the issue over the network to build
        // the link, and most callers (e.g. frequent status polls) don't need it.
        const issueUrl = isIncluded(query, 'issueUrl')
          ? await this._getIssueUrl(task)
          : undefined;
        return createSuccessResponse(
          requestId,
          200,
          issueUrl ? { ...task, issueUrl } : task,
        );
      }

      if (method === 'PATCH') {
        if (!isRecord(body)) {
          return createErrorResponse(
            requestId,
            400,
            'INVALID_INPUT',
            'PATCH body must be a JSON object',
          );
        }

        const patchShortSyntaxFlag = readIsIgnoreShortSyntax(body);
        if (!patchShortSyntaxFlag.ok) {
          return createErrorResponse(
            requestId,
            400,
            'INVALID_INPUT',
            patchShortSyntaxFlag.message,
          );
        }

        const rejected = firstRejectedField(body);
        if (rejected) {
          return createErrorResponse(
            requestId,
            400,
            'UNSUPPORTED_FIELD',
            `${rejected} cannot be set via PATCH — re-parenting is not supported by this API`,
          );
        }

        const changes = pickAllowedFields(body);
        const validation = validateWritableFields(changes);
        if (!validation.ok) {
          return createErrorResponse(
            requestId,
            400,
            'INVALID_INPUT',
            'One or more task fields have an invalid type',
            validation.errors,
          );
        }

        const deadlineValidationError = validateDeadlineFields(changes);
        if (deadlineValidationError) {
          return createErrorResponse(
            requestId,
            400,
            'INVALID_INPUT',
            deadlineValidationError,
          );
        }

        const task = await this._getTaskById(taskId);
        if (!task) {
          return createErrorResponse(requestId, 404, 'TASK_NOT_FOUND', 'Task not found');
        }

        const deadlineFields = Object.fromEntries(
          DEADLINE_FIELDS.filter((field) => hasOwn(changes, field)).map((field) => [
            field,
            changes[field],
          ]),
        ) as Partial<WritableTaskFields>;
        const deadlineResolution = resolveDeadlineChange(deadlineFields, task);
        if (!deadlineResolution.ok) {
          return createErrorResponse(
            requestId,
            400,
            'INVALID_INPUT',
            deadlineResolution.message,
          );
        }
        for (const field of DEADLINE_FIELDS) {
          delete changes[field];
        }

        if (hasOwn(changes, 'projectId')) {
          const targetProjectId = changes.projectId;
          if (typeof targetProjectId !== 'string' || !targetProjectId.trim()) {
            return createErrorResponse(
              requestId,
              400,
              'INVALID_INPUT',
              'projectId must be a non-empty string',
            );
          }
          const isProjectChange = targetProjectId !== task.projectId;
          // Echoing back the unchanged projectId is allowed on subtasks so
          // GET→PATCH round-trips don't fail; only actual changes are rejected.
          if (task.parentId && isProjectChange) {
            return createErrorResponse(
              requestId,
              400,
              'UNSUPPORTED_FIELD',
              'projectId cannot be changed directly on a subtask — move its parent task instead',
            );
          }

          if (isProjectChange) {
            // list() only contains unarchived projects, and matching by iteration
            // (not entity-map lookup) keeps prototype-property names like
            // 'constructor' from resolving to a truthy non-project.
            const targetProject = this._projectService
              .list()
              .find((project) => project.id === targetProjectId && !project.isArchived);
            if (!targetProject) {
              return createErrorResponse(
                requestId,
                404,
                'PROJECT_NOT_FOUND',
                'Destination project not found or archived',
              );
            }
          }
        }

        if (Object.keys(changes).length > 0) {
          // Short syntax only parses a title-only change set, so that is the
          // only shape the flag changes; everything else keeps going through
          // update() and whatever bookkeeping it does.
          const isTitleOnly =
            Object.keys(changes).length === 1 && hasOwn(changes, 'title');
          if (patchShortSyntaxFlag.value && isTitleOnly) {
            this._store.dispatch(
              TaskSharedActions.updateTask({
                task: { id: taskId, changes },
                isIgnoreShortSyntax: true,
              }),
            );
          } else {
            this._taskService.update(taskId, changes);
          }
        }
        if (deadlineResolution.change) {
          this._dispatchDeadlineChange(taskId, deadlineResolution.change);
        }
        return createSuccessResponse(requestId, 200, await this._getTaskById(taskId));
      }

      if (method === 'DELETE') {
        const task = await this._getTaskWithSubTasksById(taskId);
        if (!task) {
          return createErrorResponse(requestId, 404, 'TASK_NOT_FOUND', 'Task not found');
        }

        this._taskService.remove(task);
        return createSuccessResponse(requestId, 200, { deleted: true, id: taskId });
      }
    }

    if (segments.length === 3 && segments[2] === 'start' && method === 'POST') {
      const task = await this._getTaskById(taskId);
      if (!task) {
        return createErrorResponse(requestId, 404, 'TASK_NOT_FOUND', 'Task not found');
      }

      this._taskService.setCurrentId(taskId);
      return createSuccessResponse(requestId, 200, { currentTaskId: taskId });
    }

    if (segments.length === 3 && segments[2] === 'time' && method === 'POST') {
      const task = await this._getTaskById(taskId);
      const parsed = parseAddTimeSpentBody(body);
      if (!task)
        return createErrorResponse(requestId, 404, 'TASK_NOT_FOUND', 'Task not found');
      if ('error' in parsed)
        return createErrorResponse(requestId, 400, 'INVALID_INPUT', parsed.error);
      this._featureBridge.addTimeSpentOnDay(task, parsed.duration, parsed.date);
      return createSuccessResponse(requestId, 200, await this._getTaskById(taskId));
    }

    if (segments.length === 3 && segments[2] === 'archive' && method === 'POST') {
      return this._handleArchiveTask(requestId, taskId);
    }

    if (segments.length === 3 && segments[2] === 'restore' && method === 'POST') {
      return this._handleRestoreTask(requestId, taskId);
    }

    return createErrorResponse(requestId, 404, 'NOT_FOUND', 'Route not found');
  }

  private async _handleArchiveTask(
    requestId: string,
    taskId: string,
  ): Promise<LocalRestApiResponsePayload> {
    const task = await this._getTaskWithSubTasksById(taskId);
    if (!task) {
      return createErrorResponse(requestId, 404, 'TASK_NOT_FOUND', 'Task not found');
    }

    await this._taskService.moveToArchive(task);
    return createSuccessResponse(requestId, 200, { id: taskId, archived: true });
  }

  private async _handleRestoreTask(
    requestId: string,
    taskId: string,
  ): Promise<LocalRestApiResponsePayload> {
    const existsInArchive = await this._taskArchiveService.hasTask(taskId);
    if (!existsInArchive) {
      return createErrorResponse(
        requestId,
        404,
        'TASK_NOT_FOUND',
        'Task not found in archive',
      );
    }

    const archivedTask = await this._taskArchiveService.getById(taskId);
    const subTasks: Task[] = [];

    if (archivedTask.subTaskIds?.length) {
      const archive = await this._taskArchiveService.load();
      for (const subTaskId of archivedTask.subTaskIds) {
        if (archive.entities[subTaskId]) {
          subTasks.push(archive.entities[subTaskId]);
        }
      }
    }

    this._taskService.restoreTask(archivedTask, subTasks);
    const restoredTask = await this._getTaskById(taskId);
    return createSuccessResponse(requestId, 200, restoredTask);
  }

  private async _handleListProjects(
    requestId: string,
    query: Record<string, string | string[]>,
  ): Promise<LocalRestApiResponsePayload> {
    const queryText = getQueryParam(query, 'query');

    let projects = await firstValueFrom(this._projectService.list$);

    if (queryText) {
      const lowerQuery = queryText.toLowerCase();
      projects = projects.filter((p) => p.title.toLowerCase().includes(lowerQuery));
    }

    return createSuccessResponse(requestId, 200, projects);
  }

  /**
   * Only `title` is writable on project creation via the REST API — every
   * other Project field (theme, taskIds, advancedCfg, ...) is either
   * derived/managed by the app or has no legitimate external write path, so
   * this mirrors ALLOWED_TASK_FIELDS' minimal-surface approach rather than
   * exposing Partial<Project> wholesale.
   */
  private async _handleCreateProject(
    requestId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    if (!isRecord(body) || typeof body.title !== 'string' || !body.title.trim()) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'Project title must be a non-empty string',
      );
    }

    const title = body.title.trim();
    const projectId = this._projectService.add({ title });
    const created = await firstValueFrom(
      this._projectService.getByIdOnceCatchError$(projectId),
    );

    return createSuccessResponse(requestId, 201, created);
  }

  /**
   * Refuses to delete a non-empty project rather than silently cascading the
   * deletion onto its tasks — REST API callers have no task-level visibility
   * into what "delete project" would take with it, so an empty check keeps
   * this a safe, narrow-scope operation instead of a hidden bulk-delete.
   */
  private async _handleDeleteProject(
    requestId: string,
    projectId: string,
  ): Promise<LocalRestApiResponsePayload> {
    if (projectId === 'INBOX_PROJECT') {
      return createErrorResponse(
        requestId,
        400,
        'UNSUPPORTED_FIELD',
        'The Inbox project cannot be deleted',
      );
    }

    const project = await firstValueFrom(
      this._projectService.getByIdOnceCatchError$(projectId),
    );
    if (!project || project.id !== projectId) {
      return createErrorResponse(
        requestId,
        404,
        'PROJECT_NOT_FOUND',
        'Project not found',
      );
    }

    if (project.taskIds.length > 0 || project.backlogTaskIds.length > 0) {
      return createErrorResponse(
        requestId,
        400,
        'PROJECT_NOT_EMPTY',
        'Project has tasks — move or delete them first, then delete the project',
      );
    }

    await this._projectService.remove(project);
    return createSuccessResponse(requestId, 200, { deleted: true, id: projectId });
  }

  private async _handleUpdateProject(
    requestId: string,
    projectId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    if (!isRecord(body)) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'PATCH body must be a JSON object',
      );
    }

    if ('title' in body && (typeof body.title !== 'string' || !body.title.trim())) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'title must be a non-empty string',
      );
    }

    const changes = pickAllowedProjectFields(body);
    const validation = validateWritableProjectFields(changes);
    if (!validation.ok) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'One or more project fields have an invalid type',
        validation.errors,
      );
    }

    const project = await firstValueFrom(
      this._projectService.getByIdOnceCatchError$(projectId),
    );
    if (!project || project.id !== projectId) {
      return createErrorResponse(
        requestId,
        404,
        'PROJECT_NOT_FOUND',
        'Project not found',
      );
    }

    this._projectService.update(projectId, changes);
    const updated = await firstValueFrom(
      this._projectService.getByIdOnceCatchError$(projectId),
    );
    return createSuccessResponse(requestId, 200, updated);
  }

  private async _handleListTags(
    requestId: string,
    query: Record<string, string | string[]>,
  ): Promise<LocalRestApiResponsePayload> {
    const queryText = getQueryParam(query, 'query');

    let tags = await firstValueFrom(this._tagService.tags$);

    if (queryText) {
      const lowerQuery = queryText.toLowerCase();
      tags = tags.filter((t) => t.title.toLowerCase().includes(lowerQuery));
    }

    return createSuccessResponse(requestId, 200, tags);
  }

  private async _handleCreateTag(
    requestId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    if (!isRecord(body) || typeof body.title !== 'string' || !body.title.trim()) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'Tag title must be a non-empty string',
      );
    }

    const additionalFields = pickAllowedTagFields(body);
    const validation = validateWritableTagFields(additionalFields);
    if (!validation.ok) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'One or more tag fields have an invalid type',
        validation.errors,
      );
    }

    const tagId = this._tagService.addTag({
      title: body.title.trim(),
      ...additionalFields,
    });
    const created = await firstValueFrom(this._tagService.getTagById$(tagId));
    return createSuccessResponse(requestId, 201, created);
  }

  private async _handleUpdateTag(
    requestId: string,
    tagId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    if (tagId === TODAY_TAG.id) {
      return createErrorResponse(
        requestId,
        400,
        'UNSUPPORTED_FIELD',
        'The Today tag is virtual and cannot be modified',
      );
    }

    if (!isRecord(body)) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'PATCH body must be a JSON object',
      );
    }

    if ('title' in body && (typeof body.title !== 'string' || !body.title.trim())) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'title must be a non-empty string',
      );
    }

    const changes = pickAllowedTagFields(body);
    const validation = validateWritableTagFields(changes);
    if (!validation.ok) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'One or more tag fields have an invalid type',
        validation.errors,
      );
    }

    const tag = await firstValueFrom(this._tagService.getTagById$(tagId));
    if (!tag || tag.id !== tagId) {
      return createErrorResponse(requestId, 404, 'TAG_NOT_FOUND', 'Tag not found');
    }

    this._tagService.updateTag(tagId, changes);
    const updated = await firstValueFrom(this._tagService.getTagById$(tagId));
    return createSuccessResponse(requestId, 200, updated);
  }

  private async _handleDeleteTag(
    requestId: string,
    tagId: string,
  ): Promise<LocalRestApiResponsePayload> {
    if (tagId === TODAY_TAG.id) {
      return createErrorResponse(
        requestId,
        400,
        'UNSUPPORTED_FIELD',
        'The Today tag is virtual and cannot be deleted',
      );
    }

    const tag = await firstValueFrom(this._tagService.getTagById$(tagId));
    if (!tag || tag.id !== tagId) {
      return createErrorResponse(requestId, 404, 'TAG_NOT_FOUND', 'Tag not found');
    }

    this._tagService.deleteTag(tagId);
    return createSuccessResponse(requestId, 200, { deleted: true, id: tagId });
  }

  /**
   * Best-effort link to the task's issue for `GET /tasks/:id`. Returns
   * undefined when the task has no issue, the provider can't build a link, or
   * building it fails or times out — never turns the request into an error.
   */
  private async _getIssueUrl(task: Task): Promise<string | undefined> {
    const { issueType, issueId, issueProviderId } = task;
    if (!issueType || !issueId || !issueProviderId) {
      return undefined;
    }
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const url = await Promise.race([
        this._featureBridge.issueLink(issueType, issueId, issueProviderId),
        new Promise<undefined>((resolve) => {
          timeoutId = setTimeout(() => resolve(undefined), ISSUE_URL_TIMEOUT_MS);
        }),
      ]);
      return typeof url === 'string' && url ? url : undefined;
    } catch {
      IssueLog.warn('[LocalRestApi] issueUrl omitted: link lookup failed', {
        id: task.id,
      });
      return undefined;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // The id equality checks reject prototype-property names ('constructor',
  // 'toString', …) that entity-map lookups resolve to truthy non-tasks.
  private async _getTaskById(taskId: string): Promise<Task | undefined> {
    const task = await firstValueFrom(this._taskService.getByIdOnce$(taskId));
    return task?.id === taskId ? task : undefined;
  }

  private async _getTaskWithSubTasksById(
    taskId: string,
  ): Promise<TaskWithSubTasks | undefined> {
    const task = await firstValueFrom(this._taskService.getByIdWithSubTaskData$(taskId));
    return task?.id === taskId ? task : undefined;
  }
}
