// src/server.ts

import express, { Request, Response } from 'express';
import { templateStore } from './templateStore';
import { resolve } from './dataResolver';
import { runComputed } from './computedRunner';
import { render } from './renderer';
import { toHtml } from './adapters/htmlAdapter';
import { initBrowser, htmlToPdf, closeBrowser } from './adapters/pdfAdapter';
import { RenderRequest, ErrorResponse } from './types';

const app = express();

// Parse JSON request bodies up to 10MB (for passthrough/hybrid mode with large data)
app.use(express.json({ limit: '10mb' }));

// ---------------------------------------------------------------------------
// GET /template-service/api/templates
// Returns the list of all registered templates with their triggers.
// The React frontend calls this on load to know which print buttons to show.
// ---------------------------------------------------------------------------
app.get(
  '/template-service/api/templates',
  (_req: Request, res: Response) => {
    const templates = templateStore.list().map((t) => ({
      id: t.id,
      name: t.name,
      triggers: t.triggers,
      outputFormats: t.outputFormats,
    }));
    res.json({ templates });
  },
);

// ---------------------------------------------------------------------------
// POST /template-service/api/render
// Main render endpoint. Resolves data, runs computed fields, renders template.
// ---------------------------------------------------------------------------
app.post(
  '/template-service/api/render',
  async (req: Request, res: Response) => {
    const {
      templateId,
      format = 'html',
      locale = 'en',
      context,
      data,
    } = req.body as RenderRequest;

    // --- Validate required fields ---
    if (!templateId) {
      return res
        .status(400)
        .json({ error: 'templateId is required' } satisfies ErrorResponse);
    }

    if (format !== 'html' && format !== 'pdf') {
      return res.status(400).json({
        error: `Invalid format "${format}". Allowed: "html", "pdf"`,
      } satisfies ErrorResponse);
    }

    // --- Load template ---
    const template = templateStore.get(templateId);
    if (!template) {
      return res.status(404).json({
        error: `Template not found: "${templateId}"`,
      } satisfies ErrorResponse);
    }

    if (!template.outputFormats.includes(format)) {
      return res.status(400).json({
        error: `Template "${templateId}" does not support format "${format}"`,
      } satisfies ErrorResponse);
    }

    try {
      // Step 1: Resolve data sources (passthrough / fetch / hybrid)
      const sources = await resolve(
        template.dataConfig,
        context,
        data,
        req.headers.cookie,
      );

      // Step 2: Run declarative computed fields
      const computed = runComputed(template.dataConfig.computed, sources);

      // Step 3: Render Nunjucks template to HTML
      const html = render(
        template.templatePath,
        computed,
        sources,
        locale,
        template.config,
      );

      // Step 4: Return in requested format
      if (format === 'pdf') {
        const pdfBuffer = await htmlToPdf(html);
        res.set('Content-Type', 'application/pdf');
        res.set(
          'Content-Disposition',
          `attachment; filename="${templateId}.pdf"`,
        );
        return res.send(pdfBuffer);
      }

      // HTML response
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(toHtml(html));
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);

      console.error(`[Server] Render error for "${templateId}":`, message);

      // Map error types to HTTP status codes
      if (
        message.includes('Missing context variable') ||
        message.includes('Unknown source') ||
        message.includes('Invalid format')
      ) {
        return res.status(400).json({ error: message } satisfies ErrorResponse);
      }

      if (
        message.includes('OpenMRS API unreachable') ||
        message.includes('ECONNREFUSED')
      ) {
        return res
          .status(502)
          .json({ error: 'OpenMRS API unreachable' } satisfies ErrorResponse);
      }

      if (message.includes('session expired')) {
        return res
          .status(401)
          .json({ error: message } satisfies ErrorResponse);
      }

      return res.status(500).json({
        error: 'Render failed',
        detail: message,
      } satisfies ErrorResponse);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /template-service/health
// Docker health check endpoint.
// ---------------------------------------------------------------------------
app.get('/template-service/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function start(): Promise<void> {
  // Start Chromium before the server accepts requests
  await initBrowser();

  app.listen(PORT, () => {
    console.log(`[Server] Bahmni Template Service listening on port ${PORT}`);
    console.log(
      `[Server] Templates directory: ${process.env.TEMPLATES_DIR ?? '/etc/bahmni_config/print-templates'}`,
    );
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] Shutting down...');
  await closeBrowser();
  process.exit(0);
});

start().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
