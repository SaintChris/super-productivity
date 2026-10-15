import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';
import { LocalRestApiFeatureRoutes } from '../../core/electron/local-rest-api-feature-routes';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../../core/electron/local-rest-api-response';
import {
  getQueryParam,
  isRecord,
  pickAllowedTaskRepeatCfgFields,
  validateWritableTaskRepeatCfgFields,
} from '../../core/electron/local-rest-api-handler.utils';
import { TaskRepeatCfgService } from './task-repeat-cfg.service';

/**
 * Local REST API routes under `/task-repeat-configs`: list, plus PATCH of
 * title/notes/isPaused/defaultEstimate and DELETE. Older than upstream's
 * `/task-repeat-cfgs` (schedule fields, create) and kept for existing callers.
 */
@Injectable()
export class LocalRestApiTaskRepeatConfigRoutesService implements LocalRestApiFeatureRoutes {
  private readonly _taskRepeatCfgService = inject(TaskRepeatCfgService);

  async handle(
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload | undefined> {
    const { method, requestId, query, body } = request;
    const segments = request.path.split('/').filter(Boolean);
    if (segments[0] !== 'task-repeat-configs') {
      return undefined;
    }

    if (segments.length === 1 && method === 'GET') {
      return this._handleListTaskRepeatCfgs(requestId, query);
    }

    if (segments.length === 2) {
      if (method === 'PATCH') {
        return this._handleUpdateTaskRepeatCfg(requestId, segments[1], body);
      }
      if (method === 'DELETE') {
        return this._handleDeleteTaskRepeatCfg(requestId, segments[1]);
      }
    }

    return undefined;
  }

  private async _handleListTaskRepeatCfgs(
    requestId: string,
    query: Record<string, string | string[]>,
  ): Promise<LocalRestApiResponsePayload> {
    const projectId = getQueryParam(query, 'projectId');
    let cfgs = await firstValueFrom(this._taskRepeatCfgService.taskRepeatCfgs$);

    if (projectId) {
      cfgs = cfgs.filter((c) => c.projectId === projectId);
    }

    return createSuccessResponse(requestId, 200, cfgs);
  }

  private async _handleUpdateTaskRepeatCfg(
    requestId: string,
    cfgId: string,
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

    const changes = pickAllowedTaskRepeatCfgFields(body);
    const validation = validateWritableTaskRepeatCfgFields(changes);
    if (!validation.ok) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'One or more task-repeat-cfg fields have an invalid type',
        validation.errors,
      );
    }

    const cfg = await firstValueFrom(
      this._taskRepeatCfgService.getTaskRepeatCfgByIdAllowUndefined$(cfgId),
    );
    if (!cfg || cfg.id !== cfgId) {
      return createErrorResponse(
        requestId,
        404,
        'TASK_REPEAT_CFG_NOT_FOUND',
        'Task-repeat-cfg not found',
      );
    }

    this._taskRepeatCfgService.updateTaskRepeatCfg(cfgId, changes, false);
    const updated = await firstValueFrom(
      this._taskRepeatCfgService.getTaskRepeatCfgByIdAllowUndefined$(cfgId),
    );
    return createSuccessResponse(requestId, 200, updated);
  }

  private async _handleDeleteTaskRepeatCfg(
    requestId: string,
    cfgId: string,
  ): Promise<LocalRestApiResponsePayload> {
    const cfg = await firstValueFrom(
      this._taskRepeatCfgService.getTaskRepeatCfgByIdAllowUndefined$(cfgId),
    );
    if (!cfg || cfg.id !== cfgId) {
      return createErrorResponse(
        requestId,
        404,
        'TASK_REPEAT_CFG_NOT_FOUND',
        'Task-repeat-cfg not found',
      );
    }

    this._taskRepeatCfgService.deleteTaskRepeatCfg(cfgId);
    return createSuccessResponse(requestId, 200, { deleted: true, id: cfgId });
  }
}
