// src/computeScriptRunner.ts

import axios from 'axios';

const OPENMRS_URL = process.env.OPENMRS_URL ?? 'http://openmrs:8080';
const FHIR_BASE = `${OPENMRS_URL}/openmrs/ws/fhir2/R4`;
const REST_BASE = `${OPENMRS_URL}/openmrs/ws/rest/v1`;
const REQUEST_TIMEOUT_MS = parseInt(process.env.OPENMRS_TIMEOUT_MS ?? '10000', 10);

interface AuthHeaders {
  cookie?: string;
  sessionId?: string;
  authorization?: string;
}

/**
 * Builds a pre-authenticated OpenMRS client passed to compute.js.
 * Template authors use this instead of hand-rolling axios calls.
 *
 * Usage in compute.js:
 *   const bundle = await openmrs.fhir('Patient', { _id: context.patientUuid });
 *   const obs    = await openmrs.rest('obs', { patient: context.patientUuid });
 */
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
      const res = await axios.get(url, { headers, params, timeout: REQUEST_TIMEOUT_MS });
      return res.data;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        if (status === 400) {
          console.warn(`[ComputeScript] 400 from ${url} — returning empty Bundle`);
          return EMPTY_BUNDLE;
        }
        if (status === 401) throw new Error('OpenMRS session expired. Please log in again.');
        if (status === 404) return EMPTY_BUNDLE;
        if (!err.response && err.code === 'ECONNABORTED') {
          throw new Error(`OpenMRS API timeout (>${REQUEST_TIMEOUT_MS}ms) at ${url}`);
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

/**
 * Loads and executes a template's compute.js file.
 *
 * Contract for compute.js:
 *   module.exports = {
 *     compute: async function({ context, openmrs }) {
 *       // context  — { patientUuid, visitUuid, ... } from the render request
 *       // openmrs  — pre-authenticated client: openmrs.fhir(resource, params)
 *       //                                       openmrs.rest(endpoint, params)
 *       return { ... };
 *     }
 *   };
 */
export async function runComputeScript(
  scriptPath: string,
  context: Record<string, string> | undefined,
  auth: AuthHeaders,
): Promise<Record<string, unknown>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    delete require.cache[require.resolve(scriptPath)];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(scriptPath) as {
      compute?: (helpers: { context: Record<string, string> | undefined; openmrs: ReturnType<typeof buildOpenmrsClient> }) => unknown;
    };

    if (typeof mod.compute !== 'function') {
      console.warn(
        `[ComputeScript] ${scriptPath} does not export a "compute" function. Skipping.`,
      );
      return {};
    }

    const openmrs = buildOpenmrsClient(auth);
    const result = await Promise.resolve(mod.compute({ context, openmrs }));

    if (result == null || typeof result !== 'object' || Array.isArray(result)) {
      console.warn(
        `[ComputeScript] compute() must return a plain object. Got: ${typeof result}. Skipping.`,
      );
      return {};
    }

    return result as Record<string, unknown>;
  } catch (err) {
    console.error(
      `[ComputeScript] Error running ${scriptPath}:`,
      err instanceof Error ? err.message : err,
    );
    return {};
  }
}
