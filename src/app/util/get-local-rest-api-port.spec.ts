import {
  getLocalRestApiPort,
  LOCAL_REST_API_PORT_ENV,
} from '../../../electron/shared-with-frontend/get-local-rest-api-port';
import { LOCAL_REST_API_PORT } from '../../../electron/shared-with-frontend/local-rest-api.model';

describe('getLocalRestApiPort', () => {
  const env = (value: string): Record<string, string> => ({
    [LOCAL_REST_API_PORT_ENV]: value,
  });

  it('uses the default when nothing is set', () => {
    expect(getLocalRestApiPort(['electron', '.'], {})).toBe(LOCAL_REST_API_PORT);
  });

  it('uses --rest-api-port', () => {
    expect(getLocalRestApiPort(['electron', '--rest-api-port=3877'], {})).toBe(3877);
  });

  it('uses the environment variable', () => {
    expect(getLocalRestApiPort([], env('3878'))).toBe(3878);
  });

  it('prefers the argument over the environment variable', () => {
    expect(getLocalRestApiPort(['--rest-api-port=3877'], env('3878'))).toBe(3877);
  });

  it('falls back to the environment variable when the argument is invalid', () => {
    expect(getLocalRestApiPort(['--rest-api-port=abc'], env('3878'))).toBe(3878);
  });

  it('ignores ports outside 1024-65535', () => {
    expect(getLocalRestApiPort(['--rest-api-port=80'], {})).toBe(LOCAL_REST_API_PORT);
    expect(getLocalRestApiPort(['--rest-api-port=70000'], {})).toBe(LOCAL_REST_API_PORT);
  });

  it('ignores values that are not whole numbers', () => {
    expect(getLocalRestApiPort(['--rest-api-port=38.5'], {})).toBe(LOCAL_REST_API_PORT);
    expect(getLocalRestApiPort(['--rest-api-port='], {})).toBe(LOCAL_REST_API_PORT);
    expect(getLocalRestApiPort([], env('-1'))).toBe(LOCAL_REST_API_PORT);
  });

  it('accepts surrounding whitespace', () => {
    expect(getLocalRestApiPort([], env(' 3879 '))).toBe(3879);
  });
});
