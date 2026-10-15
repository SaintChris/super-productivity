import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';
import { LocalRestApiTaskRepeatConfigRoutesService } from './local-rest-api-task-repeat-config-routes.service';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from './task-repeat-cfg.model';
import { TaskRepeatCfgService } from './task-repeat-cfg.service';

describe('LocalRestApiTaskRepeatConfigRoutesService', () => {
  let service: LocalRestApiTaskRepeatConfigRoutesService;
  let cfgServiceMock: jasmine.SpyObj<TaskRepeatCfgService>;
  let cfgs$: BehaviorSubject<TaskRepeatCfg[]>;

  const createCfg = (
    id: string,
    overrides: Partial<TaskRepeatCfg> = {},
  ): TaskRepeatCfg => ({
    ...DEFAULT_TASK_REPEAT_CFG,
    id,
    projectId: 'p1',
    title: `Cfg ${id}`,
    ...overrides,
  });

  const request = (
    method: string,
    path: string,
    body?: unknown,
    query: Record<string, string> = {},
  ): LocalRestApiRequestPayload => ({
    requestId: 'test-request-id',
    method,
    path,
    query,
    body,
  });

  const handle = async (
    req: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload> => {
    const response = await service.handle(req);
    if (!response) {
      throw new Error(`Route not handled: ${req.method} ${req.path}`);
    }
    return response;
  };

  const errorCode = (response: LocalRestApiResponsePayload): string | undefined =>
    response.body.ok ? undefined : response.body.error.code;

  const data = <T>(response: LocalRestApiResponsePayload): T => {
    if (!response.body.ok) {
      throw new Error(`Expected success, got ${response.body.error.code}`);
    }
    return response.body.data as T;
  };

  beforeEach(() => {
    cfgs$ = new BehaviorSubject<TaskRepeatCfg[]>([
      createCfg('c1'),
      createCfg('c2', { projectId: 'p2' }),
    ]);

    cfgServiceMock = jasmine.createSpyObj<TaskRepeatCfgService>(
      'TaskRepeatCfgService',
      [
        'updateTaskRepeatCfg',
        'deleteTaskRepeatCfg',
        'getTaskRepeatCfgByIdAllowUndefined$',
      ],
      { taskRepeatCfgs$: cfgs$ },
    );
    cfgServiceMock.getTaskRepeatCfgByIdAllowUndefined$.and.callFake((id: string) =>
      of(cfgs$.value.find((c) => c.id === id) as TaskRepeatCfg),
    );
    cfgServiceMock.updateTaskRepeatCfg.and.callFake((id, changes) => {
      cfgs$.next(cfgs$.value.map((c) => (c.id === id ? { ...c, ...changes } : c)));
    });
    cfgServiceMock.deleteTaskRepeatCfg.and.callFake((id) => {
      cfgs$.next(cfgs$.value.filter((c) => c.id !== id));
    });

    TestBed.configureTestingModule({
      providers: [
        LocalRestApiTaskRepeatConfigRoutesService,
        { provide: TaskRepeatCfgService, useValue: cfgServiceMock },
      ],
    });
    service = TestBed.inject(LocalRestApiTaskRepeatConfigRoutesService);
  });

  it('should return undefined for paths it does not own', async () => {
    expect(await service.handle(request('GET', '/tasks'))).toBeUndefined();
    expect(await service.handle(request('GET', '/task-repeat-cfgs'))).toBeUndefined();
    expect(
      await service.handle(request('PATCH', '/task-repeat-cfgs/c1', {})),
    ).toBeUndefined();
  });

  describe('GET /task-repeat-configs', () => {
    it('should list all configs', async () => {
      const response = await handle(request('GET', '/task-repeat-configs'));
      expect(response.status).toBe(200);
      expect(data<TaskRepeatCfg[]>(response).map((c) => c.id)).toEqual(['c1', 'c2']);
    });

    it('should filter by projectId', async () => {
      const response = await handle(
        request('GET', '/task-repeat-configs', undefined, { projectId: 'p2' }),
      );
      expect(data<TaskRepeatCfg[]>(response).map((c) => c.id)).toEqual(['c2']);
    });
  });

  describe('PATCH /task-repeat-configs/:id', () => {
    it('should return 404 when missing', async () => {
      const response = await handle(
        request('PATCH', '/task-repeat-configs/nope', { title: 'x' }),
      );
      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('TASK_REPEAT_CFG_NOT_FOUND');
      expect(cfgServiceMock.updateTaskRepeatCfg).not.toHaveBeenCalled();
    });

    it('should return 400 for an invalid body', async () => {
      const response = await handle(
        request('PATCH', '/task-repeat-configs/c1', { isPaused: 'yes' }),
      );
      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expect(cfgServiceMock.updateTaskRepeatCfg).not.toHaveBeenCalled();
    });

    it('should update the config', async () => {
      const response = await handle(
        request('PATCH', '/task-repeat-configs/c1', { title: 'New', isPaused: true }),
      );
      expect(response.status).toBe(200);
      expect(cfgServiceMock.updateTaskRepeatCfg).toHaveBeenCalledWith(
        'c1',
        { title: 'New', isPaused: true },
        false,
      );
      expect(data<TaskRepeatCfg>(response).title).toBe('New');
    });
  });

  describe('DELETE /task-repeat-configs/:id', () => {
    it('should return 404 when missing', async () => {
      const response = await handle(request('DELETE', '/task-repeat-configs/nope'));
      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('TASK_REPEAT_CFG_NOT_FOUND');
      expect(cfgServiceMock.deleteTaskRepeatCfg).not.toHaveBeenCalled();
    });

    it('should delete the config', async () => {
      const response = await handle(request('DELETE', '/task-repeat-configs/c1'));
      expect(response.status).toBe(200);
      expect(cfgServiceMock.deleteTaskRepeatCfg).toHaveBeenCalledWith('c1');
      expect(data<{ deleted: boolean; id: string }>(response)).toEqual({
        deleted: true,
        id: 'c1',
      });
    });
  });
});
