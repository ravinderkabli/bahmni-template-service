import fhirpath from 'fhirpath';
import logger from '../logger';

export function evaluateFhirPath(
  resource: unknown,
  expression: string,
): unknown {
  if (resource == null) return null;

  try {
    const results: unknown[] = fhirpath.evaluate(
      resource,
      expression,
    ) as unknown[];

    if (results.length === 0) return null;
    if (results.length === 1) return results[0];
    return results;
  } catch (err) {
    logger.error({ expression, err }, 'FHIRPath evaluation error');
    return null;
  }
}
