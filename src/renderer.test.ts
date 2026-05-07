import fs from 'fs';
import os from 'os';
import path from 'path';
import { render, _resetTranslationCacheForTests } from './renderer';

/**
 * Sets up a temp templates dir with a single inline template, points
 * TEMPLATES_DIR at it, and returns a cleanup function. Used to drive
 * the renderer end-to-end without needing the real standard-config tree.
 */
function withTempTemplates(
  files: Record<string, string>,
): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmpl-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  const prev = process.env.TEMPLATES_DIR;
  process.env.TEMPLATES_DIR = dir;
  return {
    dir,
    cleanup: () => {
      if (prev === undefined) delete process.env.TEMPLATES_DIR;
      else process.env.TEMPLATES_DIR = prev;
      fs.rmSync(dir, { recursive: true, force: true });
      _resetTranslationCacheForTests();
    },
  };
}

describe('renderer', () => {
  describe('barcode filter', () => {
    it('emits a real PNG data URL (regression test for bwip-js v3 Promise bug)', async () => {
      const t = withTempTemplates({
        'demo/template.html': `{{ computed.value | barcode('code128', 40) }}`,
      });
      try {
        const html = await render(
          'demo/template.html',
          { value: 'ABC-123' },
          {},
          {},
          'en',
          {},
        );
        expect(html).toMatch(/<img src="data:image\/png;base64,/);
        const m = html.match(/base64,([A-Za-z0-9+/=]+)"/);
        expect(m).not.toBeNull();
        const b64 = m![1];
        // Must be a real PNG (starts with PNG signature 0x89 50 4E 47),
        // not a base64 of "[object Promise]" which would start with "W29ia".
        const buf = Buffer.from(b64, 'base64');
        expect(buf[0]).toBe(0x89);
        expect(buf[1]).toBe(0x50);
        expect(buf[2]).toBe(0x4e);
        expect(buf[3]).toBe(0x47);
      } finally {
        t.cleanup();
      }
    });

    it('falls back to a span when barcode generation fails', async () => {
      const t = withTempTemplates({
        'demo/template.html': `{{ computed.value | barcode('not-a-real-bcid', 40) }}`,
      });
      try {
        const html = await render(
          'demo/template.html',
          { value: 'X' },
          {},
          {},
          'en',
          {},
        );
        expect(html).toContain('<span class="barcode-fallback">X</span>');
      } finally {
        t.cleanup();
      }
    });
  });

  describe('translation cache', () => {
    it('reflects edits to the i18n file (mtime-based invalidation)', async () => {
      const t = withTempTemplates({
        '_i18n/en.json': JSON.stringify({ HELLO: 'Hi' }),
        'demo/template.html': `{{ 'HELLO' | t }}`,
      });
      try {
        const first = await render('demo/template.html', {}, {}, {}, 'en', {});
        expect(first.trim()).toBe('Hi');

        // Bump mtime forward by 2s so the cache invalidates even on
        // filesystems with whole-second mtime resolution.
        const newPath = path.join(t.dir, '_i18n', 'en.json');
        fs.writeFileSync(newPath, JSON.stringify({ HELLO: 'Howdy' }));
        const future = new Date(Date.now() + 2000);
        fs.utimesSync(newPath, future, future);

        const second = await render('demo/template.html', {}, {}, {}, 'en', {});
        expect(second.trim()).toBe('Howdy');
      } finally {
        t.cleanup();
      }
    });

    it('falls back to the raw key when no translation file exists', async () => {
      const t = withTempTemplates({
        'demo/template.html': `{{ 'MISSING_KEY' | t }}`,
      });
      try {
        const html = await render('demo/template.html', {}, {}, {}, 'en', {});
        expect(html.trim()).toBe('MISSING_KEY');
      } finally {
        t.cleanup();
      }
    });
  });
});
