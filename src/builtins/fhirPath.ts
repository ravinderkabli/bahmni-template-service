// src/builtins/fhirPath.ts

import fhirpath from 'fhirpath';

/**
 * Evaluates a FHIRPath expression against a FHIR resource or Bundle.
 *
 * Returns:
 *   - A single value if the expression matches exactly one element
 *   - An array if the expression matches multiple elements
 *   - null if the expression matches nothing
 *
 * Examples:
 *   evaluateFhirPath(patient, "Patient.name.first().text")   → "John Smith"
 *   evaluateFhirPath(bundle, "Bundle.entry.resource")        → [MedicationRequest, ...]
 *   evaluateFhirPath(obs, "Observation.valueQuantity.value") → 98.6
 */
export function evaluateFhirPath(
  resource: unknown,
  expression: string,
): unknown {
  if (resource == null) return null;

  try {
    const results: unknown[] = fhirpath.evaluate(resource, expression) as unknown[];

    if (results.length === 0) return null;
    if (results.length === 1) return results[0];
    return results;
  } catch (err) {
    console.error(
      `[FHIRPath] Error evaluating "${expression}":`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
