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

export interface LoadedTemplate {
  id: string;
  name: string;
  templatePath: string;
  computeScriptPath?: string;
  config: Record<string, unknown>;
  triggers: TemplateEntry['triggers'];
  outputFormats: TemplateEntry['outputFormats'];
}

export interface RenderRequest {
  templateId: string;
  format?: 'html';
  locale?: string;
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
