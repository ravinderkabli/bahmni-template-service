import fs from 'fs';
import path from 'path';
import logger from './logger';
import { LoadedTemplate, TemplateEntry, TemplateRegistry } from './types';

function templatesDir(): string {
  return process.env.TEMPLATES_DIR ?? '/etc/bahmni_config/print-templates';
}

interface CacheEntry<T> {
  mtimeMs: number;
  value: T;
}

class TemplateStore {
  private registryCache: CacheEntry<TemplateEntry[]> | null = null;

  list(): TemplateEntry[] {
    const registryPath = path.join(templatesDir(), 'templates.json');
    try {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(registryPath);
      } catch {
        this.registryCache = null;
        return [];
      }

      if (this.registryCache && this.registryCache.mtimeMs === stat.mtimeMs) {
        return this.registryCache.value;
      }

      const content = fs.readFileSync(registryPath, 'utf-8');
      const registry = JSON.parse(content) as TemplateRegistry;
      const templates = registry.templates ?? [];
      this.registryCache = { mtimeMs: stat.mtimeMs, value: templates };
      return templates;
    } catch (err) {
      logger.error({ err }, 'Failed to read templates.json');
      return [];
    }
  }

  get(templateId: string): LoadedTemplate | null {
    const entries = this.list();
    const entry = entries.find((t) => t.id === templateId);

    if (!entry) {
      logger.warn({ templateId }, 'Template not found');
      return null;
    }

    const templateDir = path.join(templatesDir(), entry.folder);

    const templateHtmlPath = path.join(templateDir, 'template.html');
    if (!fs.existsSync(templateHtmlPath)) {
      logger.error({ templateId }, 'Missing template.html');
      return null;
    }

    const templatePath = path.join(entry.folder, 'template.html');
    const computeScriptPath = path.join(templateDir, 'compute.js');

    return {
      id: entry.id,
      name: entry.name,
      templatePath,
      computeScriptPath: fs.existsSync(computeScriptPath)
        ? computeScriptPath
        : undefined,
      config: entry.config ?? {},
      triggers: entry.triggers ?? [],
      outputFormats: entry.outputFormats ?? ['html'],
    };
  }

  clearCache(): void {
    this.registryCache = null;
  }
}

export const templateStore = new TemplateStore();
