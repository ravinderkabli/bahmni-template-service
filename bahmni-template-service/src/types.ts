// src/types.ts

// ---------------------------------------------------------------------------
// Template registry types (templates.json)
// ---------------------------------------------------------------------------

/**
 * One entry in templates.json.
 * 'id'      - unique identifier used in the render API call
 * 'name'    - human-readable label shown in the UI
 * 'folder'  - subfolder name under TEMPLATES_DIR (e.g. "prescription")
 * 'triggers'- list of UI contexts where this template's button should appear
 * 'outputFormats' - which formats this template supports
 * 'config'  - static values the template can read (facility name, footer text, etc.)
 */
export interface TemplateEntry {
  id: string;
  name: string;
  folder: string;
  outputFormats: Array<'html' | 'pdf'>;
  triggers: Array<{
    context: string;  // e.g. "medications", "patientRegistration"
    label: string;    // e.g. "Print Prescription"
  }>;
  config?: Record<string, unknown>;
}

export interface TemplateRegistry {
  templates: TemplateEntry[];
}

// ---------------------------------------------------------------------------
// data-config.json types
// ---------------------------------------------------------------------------

/**
 * One OpenMRS API source to fetch.
 * 'api'      - "fhir" uses /openmrs/ws/fhir2/R4, "rest" uses /openmrs/ws/rest/v1
 * 'resource' - FHIR resource type (e.g. "Patient") or REST endpoint (e.g. "obs")
 * 'params'   - query parameters; {{variableName}} is replaced with context values
 */
export interface DataSource {
  api: 'fhir' | 'rest';
  resource: string;
  params?: Record<string, string>;
}

/**
 * All possible declarative computed field types.
 *
 * Each field has a 'fn' property that names the built-in function.
 * 'source' refers to either a source key (from sources) or a previously
 *          computed field key.
 *
 * Available functions:
 *   fhirPath   - evaluates a FHIRPath expression against a source resource
 *   age        - computes human-readable age from a birthDate field
 *   bmi        - computes BMI from weight (kg) and height (cm)
 *   los        - computes length of stay between two date fields
 *   abnormalFlag - returns true if an Observation is outside reference range
 *   map        - extracts multiple FHIRPath fields from each item in an array
 *   groupBy    - groups an array by a named field value
 *   sortBy     - sorts an array by a named field
 *   take       - returns the first N items from an array
 *   filter     - filters an array where field === value
 *   first      - returns the first item from an array
 *   count      - returns the length of an array
 */
export type ComputedField =
  | { fn: 'fhirPath';    source: string; expr: string }
  | { fn: 'age';         source: string; field: string }
  | { fn: 'bmi';         weightSource: string; weightField: string; heightSource: string; heightField: string }
  | { fn: 'los';         admissionSource: string; admissionField: string; dischargeSource?: string; dischargeField?: string }
  | { fn: 'abnormalFlag'; source: string }
  | { fn: 'map';         source: string; fields: Record<string, string> }
  | { fn: 'groupBy';     source: string; field: string }
  | { fn: 'sortBy';      source: string; field: string; dir?: 'asc' | 'desc' }
  | { fn: 'take';        source: string; n: number }
  | { fn: 'filter';      source: string; field: string; value: string }
  | { fn: 'filterIn';   source: string; field: string; values: string | string[] }
  | { fn: 'first';       source: string }
  | { fn: 'count';       source: string };

/**
 * Contents of a template's data-config.json file.
 */
export interface DataConfig {
  sources?: Record<string, DataSource>;
  computed?: Record<string, ComputedField>;
}

// ---------------------------------------------------------------------------
// Runtime types
// ---------------------------------------------------------------------------

/** Raw data fetched from OpenMRS, keyed by source name */
export type ResolvedSources = Record<string, unknown>;

/** Computed field results, keyed by field name */
export type ComputedResult = Record<string, unknown>;

/** A fully loaded template ready for rendering */
export interface LoadedTemplate {
  id: string;
  name: string;
  dataConfig: DataConfig;
  /** Path relative to TEMPLATES_DIR, e.g. "prescription/template.html" */
  templatePath: string;
  config: Record<string, unknown>;
  triggers: TemplateEntry['triggers'];
  outputFormats: TemplateEntry['outputFormats'];
}

// ---------------------------------------------------------------------------
// API request/response types
// ---------------------------------------------------------------------------

export interface RenderRequest {
  templateId: string;
  format?: 'html' | 'pdf';
  locale?: string;
  /** Identifiers used to fetch data from OpenMRS (patientUuid, visitUuid, etc.) */
  context?: Record<string, string>;
  /** Pre-fetched data supplied by the caller (skips API calls for those keys) */
  data?: Record<string, unknown>;
}

export interface TemplateListResponse {
  templates: Array<{
    id: string;
    name: string;
    triggers: TemplateEntry['triggers'];
    outputFormats: TemplateEntry['outputFormats'];
  }>;
}

export interface ErrorResponse {
  error: string;
  detail?: string;
}
