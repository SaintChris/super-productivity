import { LOCAL_REST_API_PORT } from './local-rest-api.model';

export const LOCAL_REST_API_PORT_ARG = '--rest-api-port=';
export const LOCAL_REST_API_PORT_ENV = 'SP_LOCAL_REST_API_PORT';

const MIN_PORT = 1024;
const MAX_PORT = 65535;

const parsePort = (raw: string | undefined): number | null => {
  if (raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (!/^\d{1,5}$/.test(trimmed)) {
    return null;
  }
  const port = Number(trimmed);
  return port >= MIN_PORT && port <= MAX_PORT ? port : null;
};

/**
 * Port for the local REST API. `--rest-api-port=<n>` wins, then the
 * SP_LOCAL_REST_API_PORT environment variable, then the default 3876.
 * Lets two profiles (separate `--user-data-dir`) run side by side.
 * An invalid value is skipped, so a typo never leaves the API without a port.
 */
export const getLocalRestApiPort = (
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): number => {
  const fromArg = argv
    .find((arg) => arg.startsWith(LOCAL_REST_API_PORT_ARG))
    ?.slice(LOCAL_REST_API_PORT_ARG.length);
  return (
    parsePort(fromArg) ?? parsePort(env[LOCAL_REST_API_PORT_ENV]) ?? LOCAL_REST_API_PORT
  );
};
