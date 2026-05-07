import { computeAge, computeBmi, computeLos, isAbnormal } from './clinical';

describe('computeAge', () => {
  it('returns years for adults', () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 30);
    expect(computeAge(d.toISOString().split('T')[0])).toBe('30 years');
  });

  it('returns months for infants', () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    expect(computeAge(d.toISOString().split('T')[0])).toBe('6 months');
  });

  it('returns days for neonates', () => {
    const d = new Date();
    d.setDate(d.getDate() - 10);
    expect(computeAge(d.toISOString().split('T')[0])).toBe('10 days');
  });

  it('returns empty string for null input', () => {
    expect(computeAge(null)).toBe('');
  });

  it('returns empty string for invalid date', () => {
    expect(computeAge('not-a-date')).toBe('');
  });
});

describe('computeBmi', () => {
  it('calculates BMI correctly', () => {
    expect(computeBmi(70, 175)).toBe('22.9');
  });

  it('returns empty string for null weight', () => {
    expect(computeBmi(null, 175)).toBe('');
  });

  it('returns empty string for null height', () => {
    expect(computeBmi(70, null)).toBe('');
  });

  it('returns empty string for zero height', () => {
    expect(computeBmi(70, 0)).toBe('');
  });
});

describe('computeLos', () => {
  it('returns days and hours for multi-day stay', () => {
    const admission = new Date();
    admission.setDate(admission.getDate() - 2);
    admission.setHours(admission.getHours() - 4);
    const result = computeLos(admission.toISOString());
    expect(result).toMatch(/2 days/);
    expect(result).toMatch(/4 hours/);
  });

  it('returns empty string for null admission', () => {
    expect(computeLos(null)).toBe('');
  });

  it('uses current time when dischargeDate is omitted', () => {
    const admission = new Date();
    admission.setMinutes(admission.getMinutes() - 45);
    const result = computeLos(admission.toISOString());
    expect(result).toBe('45 minutes');
  });
});

describe('isAbnormal', () => {
  it('returns true for High interpretation', () => {
    const obs = {
      interpretation: [
        {
          coding: [
            {
              code: 'H',
              system: 'http://hl7.org/fhir/v3/ObservationInterpretation',
            },
          ],
        },
      ],
    };
    expect(isAbnormal(obs)).toBe(true);
  });

  it('returns true for Low interpretation', () => {
    const obs = {
      interpretation: [{ coding: [{ code: 'L' }] }],
    };
    expect(isAbnormal(obs)).toBe(true);
  });

  it('returns true for Critical High interpretation', () => {
    const obs = {
      interpretation: [{ coding: [{ code: 'HH' }] }],
    };
    expect(isAbnormal(obs)).toBe(true);
  });

  it('returns false for Normal interpretation', () => {
    const obs = {
      interpretation: [{ coding: [{ code: 'N' }] }],
    };
    expect(isAbnormal(obs)).toBe(false);
  });

  it('returns false for null input', () => {
    expect(isAbnormal(null)).toBe(false);
  });

  it('returns false for observation with no interpretation', () => {
    expect(isAbnormal({ resourceType: 'Observation' })).toBe(false);
  });
});
