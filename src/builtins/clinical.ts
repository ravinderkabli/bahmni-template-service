export function computeAge(birthDate: string | null | undefined): string {
  if (!birthDate) return '';

  const birth = new Date(birthDate);
  if (isNaN(birth.getTime())) return '';

  const now = new Date();
  const years = now.getFullYear() - birth.getFullYear();
  const months = years * 12 + (now.getMonth() - birth.getMonth());
  const days = Math.floor(
    (now.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (days < 30) return `${days} day${days !== 1 ? 's' : ''}`;
  if (months < 24) return `${months} month${months !== 1 ? 's' : ''}`;
  return `${years} year${years !== 1 ? 's' : ''}`;
}

export function computeBmi(
  weightKg: number | null | undefined,
  heightCm: number | null | undefined,
): string {
  if (!weightKg || !heightCm || heightCm === 0) return '';
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  return bmi.toFixed(1);
}

export function computeLos(
  admissionDate: string | null | undefined,
  dischargeDate?: string | null,
): string {
  if (!admissionDate) return '';

  const start = new Date(admissionDate);
  const end = dischargeDate ? new Date(dischargeDate) : new Date();

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';

  const totalMinutes = Math.floor(
    (end.getTime() - start.getTime()) / (1000 * 60),
  );
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (parts.length === 0 && minutes > 0)
    parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);

  return parts.join(' ') || '< 1 minute';
}

export function isAbnormal(observation: unknown): boolean {
  if (observation == null || typeof observation !== 'object') return false;

  const obs = observation as Record<string, unknown>;
  const interpretations = obs['interpretation'];

  if (!Array.isArray(interpretations)) return false;

  const abnormalCodes = new Set(['H', 'L', 'HH', 'LL', 'A', 'AA']);

  return interpretations.some((interp: unknown) => {
    if (typeof interp !== 'object' || interp == null) return false;
    const codings = (interp as Record<string, unknown>)['coding'];
    if (!Array.isArray(codings)) return false;
    return codings.some((coding: unknown) => {
      if (typeof coding !== 'object' || coding == null) return false;
      const code = (coding as Record<string, unknown>)['code'];
      return typeof code === 'string' && abnormalCodes.has(code);
    });
  });
}
