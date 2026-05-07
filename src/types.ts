// src/types.ts

// ---------------------------------------------------------------------------
// Template registry types (templates.json)
// ---------------------------------------------------------------------------

export interface TemplateEntry {
  id: string;
  name: string;
  folder: string;
  category: string;
  outputFormats: Array<'html'>;
  triggers: Array<{ label: string }>;
  config?: Record<string, unknown>;
}

export interface TemplateRegistry {
  templates: TemplateEntry[];
}

// ---------------------------------------------------------------------------
// Runtime types
// ---------------------------------------------------------------------------

/** A fully loaded template ready for rendering */
export interface LoadedTemplate {
  id: string;
  name: string;
  /** Path relative to TEMPLATES_DIR, e.g. "registration-card/template.html" */
  templatePath: string;
  /** Absolute path to compute.js if present in the template folder */
  computeScriptPath?: string;
  config: Record<string, unknown>;
  triggers: TemplateEntry['triggers'];
  outputFormats: TemplateEntry['outputFormats'];
}

// ---------------------------------------------------------------------------
// API request/response types
// ---------------------------------------------------------------------------

export interface RenderRequest {
  templateId: string;
  format?: 'html';
  locale?: string;
  /** Identifiers forwarded to compute.js as context (patientUuid, visitUuid, etc.) */
  context?: Record<string, string>;
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
