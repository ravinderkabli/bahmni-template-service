// src/adapters/htmlAdapter.ts

/**
 * Returns the HTML string as-is.
 * The browser renders this in an iframe inside PrintModal.
 * The user then calls window.print() via the Print button.
 */
export function toHtml(html: string): string {
  return html;
}
