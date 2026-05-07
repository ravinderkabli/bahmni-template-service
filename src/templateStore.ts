// src/templateStore.ts

import fs from 'fs';
import path from 'path';
import {
  DataConfig,
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
  private dataConfigCache = new Map<string, CacheEntry<DataConfig>>();

  /**
   * Reads + caches a JSON file, refreshing only when its mtime changes.
   * Returns null if the file is missing.
   */
  private readJsonCached<T>(
    filePath: string,
    cache: CacheEntry<T> | null,
  ): { entry: CacheEntry<T> | null; missing: boolean } {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return { entry: null, missing: true };
    }

    if (cache && cache.mtimeMs === stat.mtimeMs) {
      return { entry: cache, missing: false };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const value = JSON.parse(content) as T;
    return { entry: { mtimeMs: stat.mtimeMs, value }, missing: false };
  }

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
   * Returns null if the template is not found or files are missing.
   */
  get(templateId: string): LoadedTemplate | null {
    const entries = this.list();
    const entry = entries.find((t) => t.id === templateId);

    if (!entry) {
      console.warn(`[TemplateStore] Template not found: ${templateId}`);
      return null;
    }

    const templateDir = path.join(templatesDir(), entry.folder);

    // Validate template.html exists — the only required file
    const templateHtmlPath = path.join(templateDir, 'template.html');
    if (!fs.existsSync(templateHtmlPath)) {
      console.error(
        `[TemplateStore] Missing template.html for template: ${templateId}`,
      );
      return null;
    }

    // data-config.json is optional — if absent, no API sources are fetched
    const dataConfigPath = path.join(templateDir, 'data-config.json');
    const cached = this.dataConfigCache.get(dataConfigPath) ?? null;
    let dataConfig: DataConfig = {};
    try {
      const { entry: dcEntry, missing } = this.readJsonCached<DataConfig>(
        dataConfigPath,
        cached,
      );
      if (missing) {
        this.dataConfigCache.delete(dataConfigPath);
      } else if (dcEntry) {
        this.dataConfigCache.set(dataConfigPath, dcEntry);
        dataConfig = dcEntry.value;
      }
    } catch (err) {
      console.error(
        `[TemplateStore] Failed to read data-config.json for ${templateId}:`,
        err,
      );
    }

    // templatePath is relative to templatesDir() because Nunjucks
    // FileSystemLoader is rooted at templatesDir()
    const templatePath = path.join(entry.folder, 'template.html');

    const computeScriptPath = path.join(templateDir, 'compute.js');

    return {
      id: entry.id,
      name: entry.name,
      dataConfig,
      templatePath,
      computeScriptPath: fs.existsSync(computeScriptPath) ? computeScriptPath : undefined,
      config: entry.config ?? {},
      triggers: entry.triggers ?? [],
      outputFormats: entry.outputFormats ?? ['html'],
    };
  }

  /** Test-only hook to reset caches between tests. */
  clearCache(): void {
    this.registryCache = null;
    this.dataConfigCache.clear();
  }
}

// Export a singleton instance
export const templateStore = new TemplateStore();
