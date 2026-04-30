// src/builtins/collections.ts

import { evaluateFhirPath } from './fhirPath';

/**
 * Groups an array of items by the value of a nested field.
 *
 * 'field' is a simple dot-notation path, NOT a FHIRPath expression.
 * For simple properties on flat objects (e.g., medication rows produced by 'map'),
 * use dot notation: "provider", "status".
 *
 * Returns an object where each key is a distinct field value and
 * each value is the array of items with that field value.
 *
 * Example:
 *   groupBy(medicationRows, "provider")
 *   → { "Dr. Ali": [...], "Dr. Patel": [...] }
 *
 * In Nunjucks: {% for provider, meds in computed.byProvider %}
 */
export function groupBy(
  items: unknown[],
  field: string,
): Record<string, unknown[]> {
  if (!Array.isArray(items)) return {};

  return items.reduce<Record<string, unknown[]>>((acc, item) => {
    const value = String(getNestedValue(item, field) ?? 'Unknown');
    if (!acc[value]) acc[value] = [];
    acc[value].push(item);
    return acc;
  }, {});
}

/**
 * Sorts an array of items by a named field.
 * 'dir' is "asc" (default) or "desc".
 */
export function sortBy(
  items: unknown[],
  field: string,
  dir: 'asc' | 'desc' = 'asc',
): unknown[] {
  if (!Array.isArray(items)) return [];

  return [...items].sort((a, b) => {
    const aVal = getNestedValue(a, field);
    const bVal = getNestedValue(b, field);

    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return dir === 'asc' ? 1 : -1;
    if (bVal == null) return dir === 'asc' ? -1 : 1;

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      const cmp = aVal.localeCompare(bVal);
      return dir === 'asc' ? cmp : -cmp;
    }

    const numA = Number(aVal);
    const numB = Number(bVal);
    return dir === 'asc' ? numA - numB : numB - numA;
  });
}

/**
 * Returns the first N items from an array.
 * If the array has fewer than N items, returns all of them.
 */
export function take(items: unknown[], n: number): unknown[] {
  if (!Array.isArray(items)) return [];
  return items.slice(0, n);
}

/**
 * Maps an array of FHIR resources to flat objects by evaluating FHIRPath
 * expressions for each field.
 *
 * 'fields' is a map of { outputFieldName: fhirPathExpression }.
 *
 * Example:
 *   map(medicationList, {
 *     drugName: "MedicationRequest.medicationCodeableConcept.text",
 *     dose:     "MedicationRequest.dosageInstruction.first().doseAndRate.first().doseQuantity.value"
 *   })
 *   → [{ drugName: "Amoxicillin", dose: 500 }, ...]
 *
 * This is the key function that moves all FHIRPath extraction OUT of
 * the template HTML and into data-config.json.
 */
export function map(
  items: unknown[],
  fields: Record<string, string>,
): Record<string, unknown>[] {
  if (!Array.isArray(items)) return [];

  return items.map((item) => {
    const row: Record<string, unknown> = {};
    for (const [outputKey, expr] of Object.entries(fields)) {
      row[outputKey] = evaluateFhirPath(item, expr);
    }
    return row;
  });
}

/**
 * Filters an array to items where a named field equals a given value.
 * Uses simple dot-notation path for the field name.
 */
export function filter(
  items: unknown[],
  field: string,
  value: string,
): unknown[] {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => String(getNestedValue(item, field)) === value);
}

/**
 * Filters an array to items where a named field's value is in an allowed set.
 *
 * 'values' can be either an array of strings OR a comma-separated string
 * (as passed via render context, e.g. context.selectedIds = "uuid1,uuid2").
 *
 * Use case: selective prescription print where the user picks which
 * medications to include.
 *
 * Example in data-config.json:
 *   "selectedMeds": {
 *     "fn": "filterIn",
 *     "source": "medicationRows",
 *     "field": "id",
 *     "values": "{{selectedIds}}"   ← substituted from context at runtime
 *   }
 */
export function filterIn(
  items: unknown[],
  field: string,
  values: string | string[],
): unknown[] {
  if (!Array.isArray(items)) return [];
  const normalizedValues = Array.isArray(values)
    ? values
    : String(values)
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
  const allowed = new Set(normalizedValues);
  if (allowed.size === 0) return items; // no filter → return all
  return items.filter((item) => allowed.has(String(getNestedValue(item, field))));
}

/**
 * Reads a value from a nested object using dot-notation.
 * e.g., getNestedValue({ a: { b: "hello" } }, "a.b") → "hello"
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (obj == null || typeof obj !== 'object') return undefined;
  return path.split('.').reduce<unknown>((current, key) => {
    if (current == null || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, obj);
}
