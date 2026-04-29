// src/templateStore.ts

import fs from 'fs';
import path from 'path';
import {
  DataConfig,
  LoadedTemplate,
  TemplateEntry,
  TemplateRegistry,
} from './types';

const TEMPLATES_DIR =
  process.env.TEMPLATES_DIR ?? '/etc/bahmni_config/print-templates';

class TemplateStore {
  /**
   * Returns the list of all registered templates.
   * Called by GET /template-service/api/templates.
   */
  list(): TemplateEntry[] {
    try {
      const registryPath = path.join(TEMPLATES_DIR, 'templates.json');
      const content = fs.readFileSync(registryPath, 'utf-8');
      const registry: TemplateRegistry = JSON.parse(content);
      return registry.templates ?? [];
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

    const templateDir = path.join(TEMPLATES_DIR, entry.folder);

    // Validate data-config.json exists
    const dataConfigPath = path.join(templateDir, 'data-config.json');
    if (!fs.existsSync(dataConfigPath)) {
      console.error(
        `[TemplateStore] Missing data-config.json for template: ${templateId}`,
      );
      return null;
    }

    // Validate template.html exists
    const templateHtmlPath = path.join(templateDir, 'template.html');
    if (!fs.existsSync(templateHtmlPath)) {
      console.error(
        `[TemplateStore] Missing template.html for template: ${templateId}`,
      );
      return null;
    }

    const dataConfig: DataConfig = JSON.parse(
      fs.readFileSync(dataConfigPath, 'utf-8'),
    );

    // templatePath is relative to TEMPLATES_DIR because Nunjucks
    // FileSystemLoader is rooted at TEMPLATES_DIR
    const templatePath = path.join(entry.folder, 'template.html');

    return {
      id: entry.id,
      name: entry.name,
      dataConfig,
      templatePath,
      config: entry.config ?? {},
      triggers: entry.triggers ?? [],
      outputFormats: entry.outputFormats ?? ['html'],
    };
  }
}

// Export a singleton instance
export const templateStore = new TemplateStore();
