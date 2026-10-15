import { Injectable, inject } from '@angular/core';
import { nanoid } from 'nanoid';
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
  pickAllowedNoteFields,
  validateWritableNoteFields,
} from '../../core/electron/local-rest-api-handler.utils';
import { NoteService } from './note.service';

/** Local REST API routes under `/notes`. */
@Injectable()
export class LocalRestApiNoteRoutesService implements LocalRestApiFeatureRoutes {
  private readonly _noteService = inject(NoteService);

  async handle(
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload | undefined> {
    const { method, requestId, query, body } = request;
    const segments = request.path.split('/').filter(Boolean);
    if (segments[0] !== 'notes') {
      return undefined;
    }

    if (segments.length === 1) {
      if (method === 'GET') {
        return this._handleListNotes(requestId, query);
      }
      if (method === 'POST') {
        return this._handleCreateNote(requestId, body);
      }
      return undefined;
    }

    if (segments.length === 2) {
      if (method === 'PATCH') {
        return this._handleUpdateNote(requestId, segments[1], body);
      }
      if (method === 'DELETE') {
        return this._handleDeleteNote(requestId, segments[1]);
      }
    }

    return undefined;
  }

  private async _handleListNotes(
    requestId: string,
    query: Record<string, string | string[]>,
  ): Promise<LocalRestApiResponsePayload> {
    const projectId = getQueryParam(query, 'projectId');
    let notes = await firstValueFrom(this._noteService.notes$);

    if (projectId) {
      notes = notes.filter((n) => n.projectId === projectId);
    }

    return createSuccessResponse(requestId, 200, notes);
  }

  private async _handleCreateNote(
    requestId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    if (!isRecord(body) || typeof body.content !== 'string' || !body.content.trim()) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'Note content must be a non-empty string',
      );
    }

    const additionalFields = pickAllowedNoteFields(body);
    const validation = validateWritableNoteFields(additionalFields);
    if (!validation.ok) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'One or more note fields have an invalid type',
        validation.errors,
      );
    }

    const id = nanoid();
    this._noteService.add({ id, ...additionalFields, content: body.content });
    const created = await firstValueFrom(this._noteService.getByIdOnce$(id));
    return createSuccessResponse(requestId, 201, created);
  }

  private async _handleUpdateNote(
    requestId: string,
    noteId: string,
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

    if ('content' in body && typeof body.content !== 'string') {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'content must be a string',
      );
    }

    const changes = pickAllowedNoteFields(body);
    const validation = validateWritableNoteFields(changes);
    if (!validation.ok) {
      return createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'One or more note fields have an invalid type',
        validation.errors,
      );
    }

    const note = await firstValueFrom(this._noteService.getByIdOnce$(noteId));
    if (!note || note.id !== noteId) {
      return createErrorResponse(requestId, 404, 'NOTE_NOT_FOUND', 'Note not found');
    }

    this._noteService.update(noteId, changes);
    const updated = await firstValueFrom(this._noteService.getByIdOnce$(noteId));
    return createSuccessResponse(requestId, 200, updated);
  }

  private async _handleDeleteNote(
    requestId: string,
    noteId: string,
  ): Promise<LocalRestApiResponsePayload> {
    const note = await firstValueFrom(this._noteService.getByIdOnce$(noteId));
    if (!note || note.id !== noteId) {
      return createErrorResponse(requestId, 404, 'NOTE_NOT_FOUND', 'Note not found');
    }

    this._noteService.remove(note);
    return createSuccessResponse(requestId, 200, { deleted: true, id: noteId });
  }
}
