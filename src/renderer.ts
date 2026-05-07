// src/renderer.ts

import nunjucks from 'nunjucks';
import path from 'path';
import fs from 'fs';
import * as bwipjs from 'bwip-js';
import QRCodeSVG from 'qrcode-svg';
import { computeAge } from './builtins/clinical';
import { evaluateFhirPath } from './builtins/fhirPath';

function templatesDir(): string {
  return process.env.TEMPLATES_DIR ?? '/etc/bahmni_config/print-templates';
}

interface TranslationCacheEntry {
  mtimeMs: number;
  value: Record<string, string>;
}

type BarcodeCallback = (err: Error | null, result: nunjucks.runtime.SafeString) => void;

const translationCache = new Map<string, TranslationCacheEntry>();

/**
 * Loads (and caches) the translations file for a locale.
 * Cache is invalidated when the file's mtime changes, so live edits to
 * locale JSON files are picked up without restarting the service.
 */
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
    // Drop any stale cache entry; let the | t filter fall back to English / raw key
    translationCache.delete(filePath);
    return {};
  }
}

/** Test-only hook for resetting translation cache. */
export function _resetTranslationCacheForTests(): void {
  translationCache.clear();
}

/**
 * Creates a configured Nunjucks environment for a given locale.
 * noCache: true ensures template file changes are picked up immediately.
 */
function createEnvironment(locale: string): nunjucks.Environment {
  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(templatesDir(), { noCache: true }),
    { autoescape: true, trimBlocks: true, lstripBlocks: true },
  );

  const translations = loadTranslations(locale);
  // Avoid a duplicate read when the active locale is already English
  const englishFallback = locale === 'en' ? translations : loadTranslations('en');

  // -------------------------------------------------------------------------
  // Filter: | t
  // Translates a string key to the current locale.
  // Falls back to English, then to the raw key itself.
  //
  // Usage in template:
  //   {{ 'PATIENT_NAME' | t }}              → "Patient Name"  (from locale file)
  //   {{ 'PATIENT_NAME' | t('fr') }}        → "Nom du patient"
  //   {{ 'WEIGHT' | t }} / {{ 'WEIGHT' | t('en') }}   ← bilingual
  // -------------------------------------------------------------------------
  env.addFilter('t', (key: string, overrideLocale?: string): string => {
    const t = overrideLocale ? loadTranslations(overrideLocale) : translations;
    return t[key] ?? englishFallback[key] ?? key;
  });

  // -------------------------------------------------------------------------
  // Filter: | barcode(type, height)
  // Generates a barcode as a base64-encoded PNG inline image.
  //
  // Usage in template:
  //   {{ computed.patientId | barcode('code128', 40) }}
  //   {{ computed.patientId | barcode('pdf417', 40) }}
  //
  // 'type' must be a valid bwip-js bcid string.
  //
  // Implementation note: bwip-js v3's PNG output uses zlib streams
  // and is therefore asynchronous, so this is registered as an async
  // Nunjucks filter and `render()` returns a Promise.
  // -------------------------------------------------------------------------
  env.addFilter(
    'barcode',
    (
      value: string,
      typeOrCallback: string | BarcodeCallback,
      heightOrCallback?: number | BarcodeCallback,
      maybeCallback?: BarcodeCallback,
    ) => {
      // Resolve variadic args (Nunjucks always appends the callback last)
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
        // Should never happen — Nunjucks always supplies a callback for async filters
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
              console.error('[Renderer] Barcode generation failed:', err);
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
        console.error('[Renderer] Barcode generation failed:', err);
        callback(null, fallback);
      }
    },
    true,
  );

  // -------------------------------------------------------------------------
  // Filter: | qrcode(size)
  // Generates a QR code as an inline SVG string.
  //
  // Usage in template:
  //   {{ computed.patientUuid | qrcode(120) }}
  // -------------------------------------------------------------------------
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
        // Strip the XML declaration — it breaks inline SVG rendering in HTML
        const svg = qr.svg().replace(/^<\?xml[^?]*\?>\s*/, '');
        return new nunjucks.runtime.SafeString(svg);
      } catch (err) {
        console.error('[Renderer] QR code generation failed:', err);
        return new nunjucks.runtime.SafeString(`<span class="qrcode-fallback">${value}</span>`);
      }
    },
  );

  // -------------------------------------------------------------------------
  // Filter: | dateFormat
  // Formats an ISO 8601 date string to a locale-aware human-readable date.
  //
  // Usage in template:
  //   {{ computed.visitDate | dateFormat }}      → "15 January 2024"
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Filter: | age
  // Computes age from a birthDate string.
  //
  // Usage in template:
  //   {{ computed.birthDate | age }}   → "32 years"
  // -------------------------------------------------------------------------
  env.addFilter('age', (birthDate: string): string => {
    return computeAge(birthDate);
  });

  // -------------------------------------------------------------------------
  // Filter: | fhirpathEvaluate(expression)
  // Evaluates a FHIRPath expression inline in the template.
  // Use sparingly — prefer declarative computed fields in data-config.json.
  // Useful for per-row fields in table loops.
  //
  // Usage in template:
  //   {{ med | fhirpathEvaluate("MedicationRequest.status") }}
  // -------------------------------------------------------------------------
  env.addFilter(
    'fhirpathEvaluate',
    (resource: unknown, expr: string): unknown => {
      return evaluateFhirPath(resource, expr);
    },
  );

  // -------------------------------------------------------------------------
  // Filter: | round(decimals)
  // Rounds a number to N decimal places.
  //
  // Usage in template:
  //   {{ computed.bmi | round(1) }}   → "24.3"
  // -------------------------------------------------------------------------
  env.addFilter('round', (value: number, decimals: number = 0): string => {
    if (value == null || isNaN(value)) return '';
    return value.toFixed(decimals);
  });

  return env;
}

/**
 * Renders a Nunjucks template with the given data and returns the HTML string.
 *
 * Async because the `| barcode` filter is async (bwip-js PNG output uses
 * zlib streams). All other filters are synchronous; templates that don't
 * use `| barcode` still resolve on the next tick.
 *
 * @param templatePath  Relative path to template.html (e.g. "prescription/template.html")
 * @param computed      The computed fields object from computedRunner
 * @param sources       Raw resolved sources (available in template as {{ sources.X }})
 * @param locale        BCP 47 language tag (e.g. "en", "fr", "hi")
 * @param config        Static config values from templates.json (facility name, etc.)
 */
export function render(
  templatePath: string,
  computed: Record<string, unknown>,
  compute: Record<string, unknown>,
  sources: Record<string, unknown>,
  locale: string,
  config: Record<string, unknown>,
): Promise<string> {
  const env = createEnvironment(locale);

  return new Promise((resolve, reject) => {
    env.render(
      templatePath,
      {
        computed,   // declarative computed fields (data-config.json)
        compute,    // compute.js results
        sources,    // raw fetched data
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
