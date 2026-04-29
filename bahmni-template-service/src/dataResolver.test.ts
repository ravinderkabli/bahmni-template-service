import { resolve } from './dataResolver';

jest.mock('axios', () => ({
  get: jest.fn().mockResolvedValue({ data: { resourceType: 'Patient', id: 'p1' } }),
  isAxiosError: jest.fn().mockReturnValue(false),
}));

const axios = jest.requireMock('axios');

describe('resolve', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.get.mockResolvedValue({ data: { resourceType: 'Patient', id: 'p1' } });
  });

  it('uses passthrough mode when no sources declared', async () => {
    const callerData = { patient: { name: 'Test' } };
    const result = await resolve({}, undefined, callerData, undefined);
    expect(result).toEqual(callerData);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('returns empty object when no sources and no data', async () => {
    const result = await resolve({}, undefined, undefined, undefined);
    expect(result).toEqual({});
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('uses fetch mode when sources declared and no caller data', async () => {
    const dataConfig = {
      sources: {
        patient: {
          api: 'fhir' as const,
          resource: 'Patient',
          params: { id: '{{patientUuid}}' },
        },
      },
    };
    const result = await resolve(dataConfig, { patientUuid: 'abc' }, undefined, undefined);
    expect(result['patient']).toEqual({ resourceType: 'Patient', id: 'p1' });
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('forwards Cookie header to OpenMRS in fetch mode', async () => {
    const dataConfig = {
      sources: {
        patient: {
          api: 'fhir' as const,
          resource: 'Patient',
          params: { id: '{{patientUuid}}' },
        },
      },
    };
    await resolve(dataConfig, { patientUuid: 'abc' }, undefined, 'JSESSIONID=xyz123');
    expect(axios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: 'JSESSIONID=xyz123' }),
      }),
    );
  });

  it('uses hybrid mode when sources declared AND caller data provided', async () => {
    const dataConfig = {
      sources: {
        patient: {
          api: 'fhir' as const,
          resource: 'Patient',
          params: { id: '{{patientUuid}}' },
        },
      },
    };
    const callerData = { customField: 'overrideValue' };
    const result = await resolve(dataConfig, { patientUuid: 'abc' }, callerData, undefined);
    // Caller data wins on key conflicts
    expect(result['customField']).toBe('overrideValue');
    // Fetched data also present
    expect(result['patient']).toBeDefined();
  });

  it('throws when a context variable is missing', async () => {
    const dataConfig = {
      sources: {
        patient: {
          api: 'fhir' as const,
          resource: 'Patient',
          params: { id: '{{patientUuid}}' },
        },
      },
    };
    await expect(
      resolve(dataConfig, {}, undefined, undefined),
    ).rejects.toThrow('Missing context variable');
  });

  it('throws session-expired error on 401 from OpenMRS', async () => {
    axios.isAxiosError.mockReturnValue(true);
    axios.get.mockRejectedValue({
      isAxiosError: true,
      response: { status: 401 },
    });
    const dataConfig = {
      sources: {
        patient: {
          api: 'fhir' as const,
          resource: 'Patient',
          params: { id: '{{patientUuid}}' },
        },
      },
    };
    await expect(
      resolve(dataConfig, { patientUuid: 'abc' }, undefined, undefined),
    ).rejects.toThrow('session expired');
  });
});
