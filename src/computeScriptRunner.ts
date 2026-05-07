import axios from 'axios';
import logger from './logger';

const OPENMRS_URL = process.env.OPENMRS_URL ?? 'http://openmrs:8080';
const FHIR_BASE = `${OPENMRS_URL}/openmrs/ws/fhir2/R4`;
const REST_BASE = `${OPENMRS_URL}/openmrs/ws/rest/v1`;
const REQUEST_TIMEOUT_MS = parseInt(
  process.env.OPENMRS_TIMEOUT_MS ?? '10000',
  10,
);

interface AuthHeaders {
  cookie?: string;
  sessionId?: string;
  authorization?: string;
}

function buildOpenmrsClient(auth: AuthHeaders) {
  const headers: Record<string, string> = {
    Accept: 'application/fhir+json, application/json',
  };
  if (auth.authorization) headers['Authorization'] = auth.authorization;
  if (auth.sessionId) headers['Cookie'] = `JSESSIONID=${auth.sessionId}`;
  else if (auth.cookie) headers['Cookie'] = auth.cookie;

  const EMPTY_BUNDLE = { resourceType: 'Bundle', entry: [] };

  const get = async (url: string, params?: Record<string, string>) => {
    try {
      const res = await axios.get(url, {
        headers,
        params,
        timeout: REQUEST_TIMEOUT_MS,
      });
      return res.data;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        if (status === 400) {
          logger.warn({ url }, '400 response — returning empty Bundle');
          return EMPTY_BUNDLE;
        }
        if (status === 401)
          throw new Error('OpenMRS session expired. Please log in again.');
        if (status === 404) return EMPTY_BUNDLE;
        if (!err.response && err.code === 'ECONNABORTED') {
          throw new Error(
            `OpenMRS API timeout (>${REQUEST_TIMEOUT_MS}ms) at ${url}`,
          );
        }
      }
      throw err;
    }
  };

  return {
    fhir: (resource: string, params?: Record<string, string>) =>
      get(`${FHIR_BASE}/${resource}`, params),
    rest: (endpoint: string, params?: Record<string, string>) =>
      get(`${REST_BASE}/${endpoint}`, params),
  };
}

export async function runComputeScript(
  scriptPath: string,
  context: Record<string, string> | undefined,
  auth: AuthHeaders,
): Promise<Record<string, unknown>> {
  try {
    delete require.cache[require.resolve(scriptPath)];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(scriptPath) as {
      compute?: (helpers: {
        context: Record<string, string> | undefined;
        openmrs: ReturnType<typeof buildOpenmrsClient>;
      }) => unknown;
    };

    if (typeof mod.compute !== 'function') {
      logger.warn({ scriptPath }, 'No compute function exported — skipping');
      return {};
    }

    const openmrs = buildOpenmrsClient(auth);
    const result = await Promise.resolve(mod.compute({ context, openmrs }));

    if (result == null || typeof result !== 'object' || Array.isArray(result)) {
      logger.warn(
        { scriptPath, type: typeof result },
        'compute() must return a plain object — skipping',
      );
      return {};
    }

    return result as Record<string, unknown>;
  } catch (err) {
    logger.error({ scriptPath, err }, 'Error running compute script');
    return {};
  }
}
