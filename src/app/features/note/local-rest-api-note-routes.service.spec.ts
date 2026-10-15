import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, throwError } from 'rxjs';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';
import { LocalRestApiNoteRoutesService } from './local-rest-api-note-routes.service';
import { Note } from './note.model';
import { NoteService } from './note.service';

describe('LocalRestApiNoteRoutesService', () => {
  let service: LocalRestApiNoteRoutesService;
  let noteServiceMock: jasmine.SpyObj<NoteService>;
  let notes$: BehaviorSubject<Note[]>;

  const createNote = (id: string, overrides: Partial<Note> = {}): Note => ({
    id,
    projectId: 'p1',
    isPinnedToToday: false,
    content: `Note ${id}`,
    created: 1,
    modified: 1,
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
    notes$ = new BehaviorSubject<Note[]>([
      createNote('n1'),
      createNote('n2', { projectId: 'p2' }),
    ]);

    noteServiceMock = jasmine.createSpyObj<NoteService>(
      'NoteService',
      ['add', 'update', 'remove', 'getByIdOnce$'],
      { notes$ },
    );
    // The real selector throws for a missing id; the routes must not use it.
    noteServiceMock.getByIdOnce$.and.callFake(() =>
      throwError(() => new Error('No note')),
    );
    noteServiceMock.add.and.callFake((note) => {
      notes$.next([...notes$.value, createNote(note!.id as string, note!)]);
    });
    noteServiceMock.update.and.callFake((id, changes) => {
      notes$.next(notes$.value.map((n) => (n.id === id ? { ...n, ...changes } : n)));
    });
    noteServiceMock.remove.and.callFake((note) => {
      notes$.next(notes$.value.filter((n) => n.id !== note.id));
    });

    TestBed.configureTestingModule({
      providers: [
        LocalRestApiNoteRoutesService,
        { provide: NoteService, useValue: noteServiceMock },
      ],
    });
    service = TestBed.inject(LocalRestApiNoteRoutesService);
  });

  it('should return undefined for paths it does not own', async () => {
    expect(await service.handle(request('GET', '/tasks'))).toBeUndefined();
    expect(await service.handle(request('GET', '/'))).toBeUndefined();
  });

  describe('GET /notes', () => {
    it('should list all notes', async () => {
      const response = await handle(request('GET', '/notes'));
      expect(response.status).toBe(200);
      expect(data<Note[]>(response).map((n) => n.id)).toEqual(['n1', 'n2']);
    });

    it('should filter by projectId', async () => {
      const response = await handle(
        request('GET', '/notes', undefined, { projectId: 'p2' }),
      );
      expect(data<Note[]>(response).map((n) => n.id)).toEqual(['n2']);
    });
  });

  describe('GET /notes/:id', () => {
    it('should return the note', async () => {
      const response = await handle(request('GET', '/notes/n1'));
      expect(response.status).toBe(200);
      expect(data<Note>(response).id).toBe('n1');
    });

    it('should return 404 when missing', async () => {
      const response = await handle(request('GET', '/notes/nope'));
      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('NOTE_NOT_FOUND');
    });
  });

  describe('POST /notes', () => {
    it('should return 400 for missing content', async () => {
      const response = await handle(request('POST', '/notes', {}));
      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expect(noteServiceMock.add).not.toHaveBeenCalled();
    });

    it('should return 400 for blank content', async () => {
      const response = await handle(request('POST', '/notes', { content: '   ' }));
      expect(response.status).toBe(400);
      expect(noteServiceMock.add).not.toHaveBeenCalled();
    });

    it('should return 400 for an invalid field type', async () => {
      const response = await handle(
        request('POST', '/notes', { content: 'x', isPinnedToToday: 'yes' }),
      );
      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expect(noteServiceMock.add).not.toHaveBeenCalled();
    });

    it('should create a note and return 201', async () => {
      const response = await handle(
        request('POST', '/notes', { content: 'Hello', projectId: 'p1' }),
      );
      expect(response.status).toBe(201);
      expect(noteServiceMock.add).toHaveBeenCalledTimes(1);
      const created = data<Note>(response);
      expect(created.content).toBe('Hello');
      expect(created.projectId).toBe('p1');
    });
  });

  describe('PATCH /notes/:id', () => {
    it('should return 404 when missing', async () => {
      const response = await handle(request('PATCH', '/notes/nope', { content: 'x' }));
      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('NOTE_NOT_FOUND');
      expect(noteServiceMock.update).not.toHaveBeenCalled();
    });

    it('should return 400 for an invalid body', async () => {
      const response = await handle(request('PATCH', '/notes/n1', { content: 5 }));
      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expect(noteServiceMock.update).not.toHaveBeenCalled();
    });

    it('should update the note', async () => {
      const response = await handle(
        request('PATCH', '/notes/n1', { content: 'Changed' }),
      );
      expect(response.status).toBe(200);
      expect(noteServiceMock.update).toHaveBeenCalledWith('n1', { content: 'Changed' });
      expect(data<Note>(response).content).toBe('Changed');
    });
  });

  describe('DELETE /notes/:id', () => {
    it('should return 404 when missing', async () => {
      const response = await handle(request('DELETE', '/notes/nope'));
      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('NOTE_NOT_FOUND');
      expect(noteServiceMock.remove).not.toHaveBeenCalled();
    });

    it('should delete the note', async () => {
      const response = await handle(request('DELETE', '/notes/n1'));
      expect(response.status).toBe(200);
      expect(noteServiceMock.remove).toHaveBeenCalledTimes(1);
      expect(data<{ deleted: boolean; id: string }>(response)).toEqual({
        deleted: true,
        id: 'n1',
      });
    });
  });

  it('should not use getByIdOnce$ (it throws for missing ids)', async () => {
    await handle(request('GET', '/notes/nope'));
    await handle(request('PATCH', '/notes/nope', { content: 'x' }));
    await handle(request('DELETE', '/notes/nope'));
    await handle(request('POST', '/notes', { content: 'y' }));
    expect(noteServiceMock.getByIdOnce$).not.toHaveBeenCalled();
  });

  it('should return undefined for an unsupported method on /notes/:id', async () => {
    expect(await service.handle(request('PUT', '/notes/n1', {}))).toBeUndefined();
  });
});
