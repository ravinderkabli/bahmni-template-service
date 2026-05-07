// src/dataResolver.ts

import axios from 'axios';
import { DataConfig, DataSource, ResolvedSources } from './types';

const OPENMRS_URL = process.env.OPENMRS_URL ?? 'http://openmrs:8080';
const FHIR_BASE = `${OPENMRS_URL}/openmrs/ws/fhir2/R4`;
const REST_BASE = `${OPENMRS_URL}/openmrs/ws/rest/v1`;
const REQUEST_TIMEOUT_MS = parseInt(process.env.OPENMRS_TIMEOUT_MS ?? '10000', 10);

function summarizeResponse(body: unknown): string {
  if (body == null || typeof body !== 'object') return String(body);
  const obj = body as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof obj.resourceType === 'string') parts.push(`resourceType=${obj.resourceType}`);
  if (Array.isArray(obj.entry)) parts.push(`entry=${obj.entry.length}`);
  if (Array.isArray(obj.results)) parts.push(`results=${obj.results.length}`);
  if (typeof obj.id === 'string') parts.push(`id=${obj.id}`);
  return parts.length > 0 ? `{${parts.join(', ')}}` : `(${typeof body})`;
}

interface AuthHeaders {
  cookie?: string;
  sessionId?: string;
  authorization?: string;
}

/**
 * Main entry point for data resolution.
 *
 * @param dataConfig  The template's data-config.json content
 * @param context     Caller-supplied identifiers (patientUuid, visitUuid, etc.)
 * @param data        Caller-supplied raw data (passthrough/hybrid)
 * @param auth        Auth headers forwarded from the incoming request
 */
export async function resolve(
  dataConfig: DataConfig,
  context: Record<string, string> | undefined,
  data: Record<string, unknown> | undefined,
  auth: AuthHeaders,
): Promise<ResolvedSources> {
  const hasSources =
    dataConfig.sources != null &&
    Object.keys(dataConfig.sources).length > 0;
  const hasData = data != null && Object.keys(data).length > 0;

  // PASSTHROUGH mode: no sources declared, caller already has the data
  if (!hasSources && hasData) {
    console.log('[DataResolver] Mode: passthrough');
    return data as ResolvedSources;
  }

  // FETCH mode: sources declared, no caller data
  if (hasSources && !hasData) {
    console.log('[DataResolver] Mode: fetch');
    return fetchSources(dataConfig.sources!, context ?? {}, auth);
  }

  // HYBRID mode: sources declared AND caller data provided
  // Fetch from OpenMRS, then merge — caller data wins on key conflicts
  if (hasSources && hasData) {
    console.log('[DataResolver] Mode: hybrid');
    const fetched = await fetchSources(dataConfig.sources!, context ?? {}, auth);
    return { ...fetched, ...data };
  }

  // No sources, no data — return empty (passthrough templates with no context)
  return {};
}

/**
 * Fetches all declared sources in parallel.
 */
async function fetchSources(
  sources: Record<string, DataSource>,
  context: Record<string, string>,
  auth: AuthHeaders,
): Promise<ResolvedSources> {
  const headers: Record<string, string> = {
    Accept: 'application/fhir+json, application/json',
  };
  if (auth.authorization) {
    headers['Authorization'] = auth.authorization;
  }
  if (auth.sessionId) {
    headers['Cookie'] = `JSESSIONID=${auth.sessionId}`;
  } else if (auth.cookie) {
    headers['Cookie'] = auth.cookie;
  }

  const entries = Object.entries(sources);

  // Fetch all sources in parallel
  const results = await Promise.all(
    entries.map(async ([sourceName, source]) => {
      const url = buildUrl(source, context);
      console.log(`[DataResolver] Fetching ${sourceName}: ${url}`);
      try {
        const response = await axios.get(url, { headers, timeout: REQUEST_TIMEOUT_MS });
        console.log(`[DataResolver] ${sourceName} ${response.status} ${summarizeResponse(response.data)}`);
        return [sourceName, response.data] as [string, unknown];
      } catch (err) {
        if (axios.isAxiosError(err)) {
          const status = err.response?.status;
          if (status === 401) {
            throw new Error('OpenMRS session expired. Please log in again.');
          }
          if (status === 400) {
            // Search parameter not supported by this OpenMRS version — return empty Bundle
            console.warn(`[DataResolver] Source "${sourceName}" returned 400, skipping: ${url}`);
            return [sourceName, { resourceType: 'Bundle', entry: [] }] as [string, unknown];
          }
          if (status === 404) {
            throw new Error(`OpenMRS resource not found for source: ${sourceName}`);
          }
          // Timeout / DNS / connection refused — no response received
          if (!err.response) {
            if (err.code === 'ECONNABORTED') {
              throw new Error(
                `OpenMRS API timeout (>${REQUEST_TIMEOUT_MS}ms) when fetching source: ${sourceName}`,
              );
            }
            throw new Error(
              `OpenMRS API unreachable when fetching source: ${sourceName}`,
            );
          }
        }
        throw err;
      }
    }),
  );

  return Object.fromEntries(results);
}

/**
 * Builds the full URL for a data source, substituting context variables.
 *
 * Example:
 *   source.params = { subject: "{{patientUuid}}", status: "active" }
 *   context       = { patientUuid: "abc-123" }
 *   result        = /openmrs/ws/fhir2/R4/MedicationRequest?subject=abc-123&status=active
 */
function buildUrl(
  source: DataSource,
  context: Record<string, string>,
): string {
  const base = source.api === 'fhir' ? FHIR_BASE : REST_BASE;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(source.params ?? {})) {
    // Replace {{variableName}} with the corresponding context value
    const substituted = value.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
      const resolved = context[varName];
      if (resolved == null) {
        throw new Error(
          `Missing context variable "{{${varName}}}" required by source param "${key}"`,
        );
      }
      return resolved;
    });
    params.append(key, substituted);
  }

  const paramStr = params.toString();
  return `${base}/${source.resource}${paramStr ? `?${paramStr}` : ''}`;
}
