// src/adapters/pdfAdapter.ts

import puppeteer, { Browser } from 'puppeteer-core';

let browser: Browser | null = null;

// Promise chain that serializes PDF renders one at a time
let queue: Promise<Buffer | null> = Promise.resolve(null);

/**
 * Starts a single Chromium browser instance at service startup.
 * Called once from server.ts before the Express server begins listening.
 */
export async function initBrowser(): Promise<void> {
  const executablePath =
    process.env.CHROMIUM_PATH ??
    '/ms-playwright/chromium-1148/chrome-linux/chrome';

  console.log(`[PdfAdapter] Launching Chromium at: ${executablePath}`);

  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',              // required when running as root in Docker
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',   // prevents crashes in low-memory containers
      '--disable-gpu',
    ],
  });

  console.log('[PdfAdapter] Chromium ready');
}

/**
 * Renders an HTML string to a PDF binary buffer.
 *
 * Opens a new page in the shared browser, sets the HTML content,
 * generates a PDF, and closes the page. Requests are queued so
 * they execute one at a time.
 *
 * @param html  The full HTML string to render
 * @returns     A Buffer containing the PDF binary
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  if (!browser) {
    throw new Error('Browser not initialized. Call initBrowser() first.');
  }

  // Chain onto the queue — each PDF render waits for the previous one
  const result = (queue = queue.then(async (): Promise<Buffer> => {
    const page = await browser!.newPage();
    try {
      // waitUntil: 'networkidle0' ensures all images and fonts are loaded
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,  // include background colours and images
        margin: {
          top: '15mm',
          bottom: '15mm',
          left: '15mm',
          right: '15mm',
        },
      });

      return Buffer.from(pdf);
    } finally {
      // Always close the page to free memory, even if pdf() throws
      await page.close();
    }
  })) as Promise<Buffer>;

  return result;
}

/**
 * Gracefully closes the browser. Call this on process exit.
 */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    console.log('[PdfAdapter] Browser closed');
  }
}
