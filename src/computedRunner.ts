// src/computedRunner.ts

import { ComputedField, ComputedResult, ResolvedSources } from './types';
import { evaluateFhirPath } from './builtins/fhirPath';
import { computeAge, computeBmi, computeLos, isAbnormal } from './builtins/clinical';
import {
  groupBy,
  sortBy,
  take,
  map,
  filter,
  filterIn,
} from './builtins/collections';

/**
 * Executes all computed field declarations and returns their results.
 *
 * @param computed  The "computed" block from data-config.json
 * @param sources   Raw data fetched from OpenMRS (or passed by the caller)
 * @returns         A flat object of { fieldName: computedValue }
 */
export function runComputed(
  computed: Record<string, ComputedField> | undefined,
  sources: ResolvedSources,
): ComputedResult {
  if (!computed) return {};

  const result: ComputedResult = {};

  for (const [key, field] of Object.entries(computed)) {
    try {
      result[key] = executeField(field, sources, result);
    } catch (err) {
      // Log but do not crash — template will receive null for failed fields
      console.error(
        `[ComputedRunner] Error computing field "${key}":`,
        err instanceof Error ? err.message : err,
      );
      result[key] = null;
    }
  }

  return result;
}

/**
 * Executes a single computed field declaration.
 * 'computed' contains results of previously processed fields, so a later
 * field can use an earlier one as its source.
 */
function executeField(
  field: ComputedField,
  sources: ResolvedSources,
  computed: ComputedResult,
): unknown {
  /**
   * Resolves a source name — looks first in already-computed fields,
   * then in fetched sources. This allows chaining:
   *   "medicationList" → computed from "medications" source
   *   "byProvider"     → computed from "medicationList"
   */
  const resolve = (sourceName: string): unknown => {
    if (sourceName in computed) return computed[sourceName];
    if (sourceName in sources) return sources[sourceName];
    throw new Error(
      `Unknown source "${sourceName}". Available: ${[
        ...Object.keys(sources),
        ...Object.keys(computed),
      ].join(', ')}`,
    );
  };

  switch (field.fn) {
    case 'fhirPath': {
      return evaluateFhirPath(resolve(field.source), field.expr);
    }

    case 'age': {
      const resource = resolve(field.source);
      const birthDate = evaluateFhirPath(resource, field.field) as string;
      return computeAge(birthDate);
    }

    case 'bmi': {
      const weightVal = evaluateFhirPath(
        resolve(field.weightSource), field.weightField,
      ) as number;
      const heightVal = evaluateFhirPath(
        resolve(field.heightSource), field.heightField,
      ) as number;
      return computeBmi(weightVal, heightVal);
    }

    case 'los': {
      const admissionVal = evaluateFhirPath(
        resolve(field.admissionSource), field.admissionField,
      ) as string;
      let dischargeVal: string | undefined;
      if (field.dischargeSource && field.dischargeField) {
        dischargeVal = evaluateFhirPath(
          resolve(field.dischargeSource), field.dischargeField,
        ) as string;
      }
      return computeLos(admissionVal, dischargeVal);
    }

    case 'abnormalFlag': {
      return isAbnormal(resolve(field.source));
    }

    case 'map': {
      return map(resolve(field.source) as unknown[], field.fields);
    }

    case 'groupBy': {
      return groupBy(resolve(field.source) as unknown[], field.field);
    }

    case 'sortBy': {
      return sortBy(resolve(field.source) as unknown[], field.field, field.dir);
    }

    case 'take': {
      return take(resolve(field.source) as unknown[], field.n);
    }

    case 'filter': {
      return filter(resolve(field.source) as unknown[], field.field, field.value);
    }

    case 'filterIn': {
      return filterIn(
        resolve(field.source) as unknown[],
        field.field,
        field.values as string | string[],
      );
    }

    case 'first': {
      const val = resolve(field.source);
      return Array.isArray(val) ? (val[0] ?? null) : val;
    }

    case 'count': {
      const val = resolve(field.source);
      return Array.isArray(val) ? val.length : 0;
    }

    default:
      throw new Error(`Unknown computed function: ${(field as { fn: string }).fn}`);
  }
}
