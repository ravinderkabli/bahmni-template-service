// src/server.ts

import express, { Request, Response } from 'express';
import { templateStore } from './templateStore';
import { runComputeScript } from './computeScriptRunner';
import { render } from './renderer';
import { toHtml } from './adapters/htmlAdapter';
import { RenderRequest, ErrorResponse } from './types';

const app = express();

app.use(express.json());

const DEBUG = (process.env.LOG_LEVEL ?? '').toLowerCase() === 'debug';

interface AuthHeaders {
  cookie?: string;
  sessionId?: string;
  authorization?: string;
}

function buildAuthHeaders(req: Request): AuthHeaders {
  return {
    cookie: req.headers.cookie,
    sessionId: req.headers['x-openmrs-session-id'] as string | undefined,
    authorization: req.headers['x-openmrs-authorization'] as string | undefined,
  };
}

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
      category: t.category,
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
    } = req.body as RenderRequest;

    if (DEBUG) {
      const authHeader = req.headers['x-openmrs-authorization'] as string | undefined;
      console.log('[Server] Incoming session headers:', {
        cookie: req.headers.cookie ? '(present)' : '(none)',
        'x-openmrs-session-id': req.headers['x-openmrs-session-id'] ? '(present)' : '(none)',
        'x-openmrs-authorization': authHeader ? `${authHeader.split(' ')[0]} (present)` : '(none)',
      });
    }

    // --- Validate required fields ---
    if (!templateId) {
      return res
        .status(400)
        .json({ error: 'templateId is required' } satisfies ErrorResponse);
    }

    if (format !== 'html') {
      return res.status(400).json({
        error: `Invalid format "${format}". Only "html" is supported.`,
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
      console.log('[Server] Render', {
        id: template.id,
        hasComputeScript: !!template.computeScriptPath,
      });

      const auth = buildAuthHeaders(req);

      // Run compute.js if present — it fetches and transforms all data
      const compute = template.computeScriptPath
        ? await runComputeScript(template.computeScriptPath, context, auth)
        : {};

      // Render Nunjucks template to HTML
      const html = await render(
        template.templatePath,
        compute,
        locale,
        template.config,
      );

      // Step 4: Return HTML (browser handles print dialog)
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(toHtml(html));
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);

      console.error(`[Server] Render error for "${templateId}":`, message);

      // Map error types to HTTP status codes
      if (message.includes('Invalid format')) {
        return res.status(400).json({ error: message } satisfies ErrorResponse);
      }

      if (
        message.includes('OpenMRS API unreachable') ||
        message.includes('ECONNREFUSED') ||
        message.includes('OpenMRS API timeout')
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

      if (message.includes('OpenMRS resource not found')) {
        return res
          .status(404)
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
  app.listen(PORT, () => {
    console.log(`[Server] Bahmni Template Service listening on port ${PORT}`);
    console.log(
      `[Server] Templates directory: ${process.env.TEMPLATES_DIR ?? '/etc/bahmni_config/print-templates'}`,
    );
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] Shutting down...');
  process.exit(0);
});

start().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
