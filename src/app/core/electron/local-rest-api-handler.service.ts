import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { ProjectService } from '../../features/project/project.service';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { TagService } from '../../features/tag/tag.service';
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
import { LOCAL_REST_API_FEATURE_ROUTES } from './local-rest-api-feature-routes';
import { createErrorResponse, createSuccessResponse } from './local-rest-api-response';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';

const getQueryParam = (
  query: Record<string, string | string[]>,
  key: string,
): string | undefined => {
  const value = query[key];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Routes Local REST API requests. Focus, the project list, and the tag list
 * stay here. Task rules and the other feature routes answer through
 * LOCAL_REST_API_FEATURE_ROUTES.
 */
@Injectable({
  providedIn: 'root',
})
export class LocalRestApiHandlerService {
  private readonly _projectService = inject(ProjectService);
  private readonly _tagService = inject(TagService);
  private readonly _featureRoutes =
    inject(LOCAL_REST_API_FEATURE_ROUTES, { optional: true }) ?? [];
  private readonly _store = inject(Store);
  private _isInitialized = false;

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
    const { method, path, requestId, query } = payload;

    if (method === 'GET' && path === '/focus') {
      return this._handleGetFocus(requestId);
    }

    if (method === 'GET' && path === '/projects') {
      return this._handleListProjects(requestId, query);
    }

    if (method === 'GET' && path === '/tags') {
      return this._handleListTags(requestId, query);
    }

    for (const routes of this._featureRoutes) {
      const response = await routes.handle(payload);
      if (response) {
        return response;
      }
    }

    return createErrorResponse(requestId, 404, 'NOT_FOUND', 'Route not found');
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
}
