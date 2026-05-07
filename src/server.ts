import express, { Request, Response } from 'express';
import { toHtml } from './adapters/htmlAdapter';
import { runComputeScript } from './computeScriptRunner';
import logger from './logger';
import { render } from './renderer';
import { templateStore } from './templateStore';
import { RenderRequest, ErrorResponse } from './types';

const app = express();

app.use(express.json());

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

app.get('/template-service/api/templates', (_req: Request, res: Response) => {
  const templates = templateStore.list().map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    triggers: t.triggers,
    outputFormats: t.outputFormats,
  }));
  res.json({ templates });
});

app.post(
  '/template-service/api/render',
  async (req: Request, res: Response) => {
    const {
      templateId,
      format = 'html',
      locale = 'en',
      context,
    } = req.body as RenderRequest;

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
      logger.info(
        { templateId, hasComputeScript: !!template.computeScriptPath },
        'Render',
      );

      const auth = buildAuthHeaders(req);

      const compute = template.computeScriptPath
        ? await runComputeScript(template.computeScriptPath, context, auth)
        : {};

      const html = await render(
        template.templatePath,
        compute,
        locale,
        template.config,
      );

      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(toHtml(html));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      logger.error({ templateId, message }, 'Render failed');

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
        return res.status(401).json({ error: message } satisfies ErrorResponse);
      }

      if (message.includes('OpenMRS resource not found')) {
        return res.status(404).json({ error: message } satisfies ErrorResponse);
      }

      return res.status(500).json({
        error: 'Render failed',
        detail: message,
      } satisfies ErrorResponse);
    }
  },
);

app.get('/template-service/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function start(): Promise<void> {
  app.listen(PORT, () => {
    logger.info(
      {
        port: PORT,
        templatesDir:
          process.env.TEMPLATES_DIR ?? '/etc/bahmni_config/print-templates',
      },
      'Bahmni Template Service listening',
    );
  });
}

process.on('SIGTERM', () => {
  logger.info('Shutting down');
  process.exit(0);
});

start().catch((err) => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
