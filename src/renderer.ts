import fs from 'fs';
import path from 'path';
import * as bwipjs from 'bwip-js';
import nunjucks from 'nunjucks';
import QRCodeSVG from 'qrcode-svg';
import { computeAge } from './builtins/clinical';
import { evaluateFhirPath } from './builtins/fhirPath';
import logger from './logger';

function templatesDir(): string {
  return process.env.TEMPLATES_DIR ?? '/etc/bahmni_config/print-templates';
}

interface TranslationCacheEntry {
  mtimeMs: number;
  value: Record<string, string>;
}

type BarcodeCallback = (
  err: Error | null,
  result: nunjucks.runtime.SafeString,
) => void;

const translationCache = new Map<string, TranslationCacheEntry>();

function loadTranslations(locale: string): Record<string, string> {
  const filePath = path.join(templatesDir(), '_i18n', `${locale}.json`);
  try {
    const stat = fs.statSync(filePath);
    const cached = translationCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.value;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const value = JSON.parse(content) as Record<string, string>;
    translationCache.set(filePath, { mtimeMs: stat.mtimeMs, value });
    return value;
  } catch {
    translationCache.delete(filePath);
    return {};
  }
}

export function _resetTranslationCacheForTests(): void {
  translationCache.clear();
}

function createEnvironment(locale: string): nunjucks.Environment {
  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(templatesDir(), { noCache: true }),
    { autoescape: true, trimBlocks: true, lstripBlocks: true },
  );

  const translations = loadTranslations(locale);
  const englishFallback =
    locale === 'en' ? translations : loadTranslations('en');

  env.addFilter('t', (key: string, overrideLocale?: string): string => {
    const t = overrideLocale ? loadTranslations(overrideLocale) : translations;
    return t[key] ?? englishFallback[key] ?? key;
  });

  env.addFilter(
    'barcode',
    (
      value: string,
      typeOrCallback: string | BarcodeCallback,
      heightOrCallback?: number | BarcodeCallback,
      maybeCallback?: BarcodeCallback,
    ) => {
      let type: string = 'code128';
      let height: number = 40;
      let callback: BarcodeCallback;

      if (typeof typeOrCallback === 'function') {
        callback = typeOrCallback;
      } else if (typeof heightOrCallback === 'function') {
        type = typeOrCallback;
        callback = heightOrCallback;
      } else if (typeof maybeCallback === 'function') {
        type = typeOrCallback;
        height = heightOrCallback as number;
        callback = maybeCallback;
      } else {
        return;
      }

      const fallback = new nunjucks.runtime.SafeString(
        `<span class="barcode-fallback">${value}</span>`,
      );

      try {
        bwipjs.toBuffer(
          {
            bcid: type,
            text: String(value),
            height,
            includetext: true,
            textxalign: 'center',
          },
          (err: Error | string | null, png: Buffer) => {
            if (err || !png) {
              logger.error({ err }, 'Barcode generation failed');
              callback(null, fallback);
              return;
            }
            const base64 = png.toString('base64');
            callback(
              null,
              new nunjucks.runtime.SafeString(
                `<img src="data:image/png;base64,${base64}" alt="${value}" style="display:block;" />`,
              ),
            );
          },
        );
      } catch (err) {
        logger.error({ err }, 'Barcode generation failed');
        callback(null, fallback);
      }
    },
    true,
  );

  env.addFilter(
    'qrcode',
    (value: string, size: number = 120): nunjucks.runtime.SafeString => {
      if (!value) return new nunjucks.runtime.SafeString('');
      try {
        const qr = new QRCodeSVG({
          content: String(value),
          width: size,
          height: size,
          container: 'svg-viewbox',
          join: true,
          pretty: false,
        });
        const svg = qr.svg().replace(/^<\?xml[^?]*\?>\s*/, '');
        return new nunjucks.runtime.SafeString(svg);
      } catch (err) {
        logger.error({ err }, 'QR code generation failed');
        return new nunjucks.runtime.SafeString(
          `<span class="qrcode-fallback">${value}</span>`,
        );
      }
    },
  );

  env.addFilter('dateFormat', (value: string): string => {
    try {
      const date = new Date(value);
      if (isNaN(date.getTime())) return value ?? '';
      return date.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return value ?? '';
    }
  });

  env.addFilter('age', (birthDate: string): string => {
    return computeAge(birthDate);
  });

  env.addFilter(
    'fhirpathEvaluate',
    (resource: unknown, expr: string): unknown => {
      return evaluateFhirPath(resource, expr);
    },
  );

  env.addFilter('round', (value: number, decimals: number = 0): string => {
    if (value == null || isNaN(value)) return '';
    return value.toFixed(decimals);
  });

  return env;
}

export function render(
  templatePath: string,
  compute: Record<string, unknown>,
  locale: string,
  config: Record<string, unknown>,
): Promise<string> {
  const env = createEnvironment(locale);

  return new Promise((resolve, reject) => {
    env.render(
      templatePath,
      {
        compute,
        locale,
        config,
        now: new Date(),
      },
      (err, html) => {
        if (err) reject(err);
        else resolve(html ?? '');
      },
    );
  });
}
