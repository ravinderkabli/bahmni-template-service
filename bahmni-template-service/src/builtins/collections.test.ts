import { groupBy, sortBy, take, map, filter, filterIn } from './collections';

const medications = [
  { provider: 'Dr. Ali',   drugName: 'Amoxicillin', dose: 500,  status: 'active'  },
  { provider: 'Dr. Ali',   drugName: 'Ibuprofen',   dose: 200,  status: 'active'  },
  { provider: 'Dr. Patel', drugName: 'Paracetamol', dose: 1000, status: 'stopped' },
];

describe('groupBy', () => {
  it('groups items by field value', () => {
    const result = groupBy(medications, 'provider');
    expect(Object.keys(result)).toEqual(['Dr. Ali', 'Dr. Patel']);
    expect(result['Dr. Ali']).toHaveLength(2);
    expect(result['Dr. Patel']).toHaveLength(1);
  });

  it('returns empty object for empty array', () => {
    expect(groupBy([], 'provider')).toEqual({});
  });

  it('returns empty object for non-array input', () => {
    expect(groupBy('not-an-array' as unknown as unknown[], 'provider')).toEqual({});
  });
});

describe('sortBy', () => {
  it('sorts ascending by default', () => {
    const result = sortBy(medications, 'dose') as typeof medications;
    expect(result[0].dose).toBe(200);
    expect(result[2].dose).toBe(1000);
  });

  it('sorts descending when dir is desc', () => {
    const result = sortBy(medications, 'dose', 'desc') as typeof medications;
    expect(result[0].dose).toBe(1000);
    expect(result[2].dose).toBe(200);
  });

  it('sorts strings alphabetically', () => {
    const result = sortBy(medications, 'drugName') as typeof medications;
    expect(result[0].drugName).toBe('Amoxicillin');
    expect(result[1].drugName).toBe('Ibuprofen');
    expect(result[2].drugName).toBe('Paracetamol');
  });

  it('returns empty array for non-array input', () => {
    expect(sortBy('bad' as unknown as unknown[], 'dose')).toEqual([]);
  });
});

describe('take', () => {
  it('returns first N items', () => {
    expect(take(medications, 2)).toHaveLength(2);
    expect((take(medications, 2) as typeof medications)[0].drugName).toBe('Amoxicillin');
  });

  it('returns all items if N exceeds array length', () => {
    expect(take(medications, 10)).toHaveLength(3);
  });

  it('returns empty for non-array input', () => {
    expect(take('bad' as unknown as unknown[], 2)).toEqual([]);
  });
});

describe('map', () => {
  const fhirMeds = [
    { medicationCodeableConcept: { text: 'Amoxicillin' }, status: 'active' },
    { medicationCodeableConcept: { text: 'Ibuprofen' },   status: 'stopped' },
  ];

  it('extracts flat fields from array items', () => {
    const result = map(fhirMeds as unknown[], {
      drugName: 'medicationCodeableConcept.text',
      status:   'status',
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ drugName: 'Amoxicillin', status: 'active' });
    expect(result[1]).toMatchObject({ drugName: 'Ibuprofen',   status: 'stopped' });
  });

  it('returns empty array for non-array input', () => {
    expect(map('bad' as unknown as unknown[], {})).toEqual([]);
  });
});

describe('filter', () => {
  it('filters items by field value', () => {
    const result = filter(medications, 'status', 'active');
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no match', () => {
    expect(filter(medications, 'status', 'unknown')).toHaveLength(0);
  });

  it('returns empty array for non-array input', () => {
    expect(filter('bad' as unknown as unknown[], 'status', 'active')).toEqual([]);
  });
});

describe('filterIn', () => {
  const items = [
    { id: 'abc', name: 'Amoxicillin' },
    { id: 'def', name: 'Ibuprofen'   },
    { id: 'ghi', name: 'Paracetamol' },
  ];

  it('filters by comma-separated string of IDs', () => {
    const result = filterIn(items, 'id', 'abc,ghi');
    expect(result).toHaveLength(2);
    expect((result as typeof items)[0].id).toBe('abc');
    expect((result as typeof items)[1].id).toBe('ghi');
  });

  it('filters by array of IDs', () => {
    const result = filterIn(items, 'id', ['abc', 'def']);
    expect(result).toHaveLength(2);
  });

  it('returns all items when values is empty string', () => {
    const result = filterIn(items, 'id', '');
    expect(result).toHaveLength(3);
  });

  it('returns empty array for non-array input', () => {
    expect(filterIn('bad' as unknown as unknown[], 'id', 'abc')).toEqual([]);
  });
});
