// src/templateStore.ts

import fs from 'fs';
import path from 'path';
import {
  LoadedTemplate,
  TemplateEntry,
  TemplateRegistry,
} from './types';

function templatesDir(): string {
  return process.env.TEMPLATES_DIR ?? '/etc/bahmni_config/print-templates';
}

interface CacheEntry<T> {
  mtimeMs: number;
  value: T;
}

class TemplateStore {
  private registryCache: CacheEntry<TemplateEntry[]> | null = null;

  /**
   * Returns the list of all registered templates.
   * Re-reads templates.json only when its mtime has changed.
   */
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
      console.error('[TemplateStore] Failed to read templates.json:', err);
      return [];
    }
  }

  /**
   * Loads and returns a single template by ID.
   * Returns null if the template is not found or template.html is missing.
   */
  get(templateId: string): LoadedTemplate | null {
    const entries = this.list();
    const entry = entries.find((t) => t.id === templateId);

    if (!entry) {
      console.warn(`[TemplateStore] Template not found: ${templateId}`);
      return null;
    }

    const templateDir = path.join(templatesDir(), entry.folder);

    // template.html is the only required file
    const templateHtmlPath = path.join(templateDir, 'template.html');
    if (!fs.existsSync(templateHtmlPath)) {
      console.error(
        `[TemplateStore] Missing template.html for template: ${templateId}`,
      );
      return null;
    }

    // templatePath is relative to templatesDir() — Nunjucks FileSystemLoader is rooted there
    const templatePath = path.join(entry.folder, 'template.html');
    const computeScriptPath = path.join(templateDir, 'compute.js');

    return {
      id: entry.id,
      name: entry.name,
      templatePath,
      computeScriptPath: fs.existsSync(computeScriptPath) ? computeScriptPath : undefined,
      config: entry.config ?? {},
      triggers: entry.triggers ?? [],
      outputFormats: entry.outputFormats ?? ['html'],
    };
  }

  /** Test-only hook to reset the registry cache between tests. */
  clearCache(): void {
    this.registryCache = null;
  }
}

// Export a singleton instance
export const templateStore = new TemplateStore();
