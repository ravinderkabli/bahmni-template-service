// src/renderer.ts

import nunjucks from 'nunjucks';
import path from 'path';
import fs from 'fs';
import * as bwipjs from 'bwip-js';
import QRCodeSVG from 'qrcode-svg';
import { computeAge } from './builtins/clinical';
import { evaluateFhirPath } from './builtins/fhirPath';

const TEMPLATES_DIR =
  process.env.TEMPLATES_DIR ?? '/etc/bahmni_config/print-templates';

function loadTranslations(locale: string): Record<string, string> {
  const filePath = path.join(TEMPLATES_DIR, '_i18n', `${locale}.json`);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, string>;
  } catch {
    // Return empty map — the | t filter will fall back to English or the raw key
    return {};
  }
}

/**
 * Creates a configured Nunjucks environment for a given locale.
 * noCache: true ensures template file changes are picked up immediately.
 */
function createEnvironment(locale: string): nunjucks.Environment {
  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(TEMPLATES_DIR, { noCache: true }),
    { autoescape: true, trimBlocks: true, lstripBlocks: true },
  );

  const translations = loadTranslations(locale);
  const englishFallback = loadTranslations('en');

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
  //   {{ computed.patientId | barcode('qrcode', 80) }}
  //
  // 'type' must be a valid bwip-js bcid string.
  // Mark as safe (second arg true) so Nunjucks does not escape the HTML.
  // -------------------------------------------------------------------------
  env.addFilter(
    'barcode',
    (value: string, type: string = 'code128', height: number = 40): string => {
      try {
        const png = bwipjs.toBuffer({
          bcid: type,
          text: String(value),
          height,
          includetext: true,
          textxalign: 'center',
        });
        const base64 = png.toString('base64');
        return `<img src="data:image/png;base64,${base64}" alt="${value}" style="display:block;" />`;
      } catch (err) {
        console.error('[Renderer] Barcode generation failed:', err);
        return `<span class="barcode-fallback">${value}</span>`;
      }
    },
    true, // mark output as safe HTML
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
    (value: string, size: number = 120): string => {
      try {
        const qr = new QRCodeSVG({
          content: String(value),
          width: size,
          height: size,
          container: 'svg-viewbox',
          join: true,
          pretty: false,
        });
        return qr.svg();
      } catch (err) {
        console.error('[Renderer] QR code generation failed:', err);
        return `<span>${value}</span>`;
      }
    },
    true,
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
): string {
  const env = createEnvironment(locale);

  return env.render(templatePath, {
    computed,   // declarative computed fields (data-config.json)
    compute,    // compute.js results
    sources,    // raw fetched data
    locale,
    config,
    now: new Date(),
  });
}
