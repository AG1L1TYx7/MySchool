/**
 * Refresh-session lifetimes (docs/11 section 3): each rotation extends the sliding expiry,
 * but never past the family's absolute limit set when the user signed in.
 */
export interface SessionExpiry {
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export function sessionExpiry(input: {
  now: Date;
  slidingDays: number;
  absoluteDays: number;
  familyAbsoluteExpiresAt?: Date | null;
}): SessionExpiry {
  const absoluteExpiresAt =
    input.familyAbsoluteExpiresAt ??
    new Date(input.now.getTime() + input.absoluteDays * 86_400_000);
  const sliding = new Date(
    input.now.getTime() + input.slidingDays * 86_400_000,
  );
  return {
    expiresAt: sliding < absoluteExpiresAt ? sliding : absoluteExpiresAt,
    absoluteExpiresAt,
  };
}

/** The refresh cookie lives exactly as long as the session it carries. */
export function cookieMaxAgeMs(expiresAt: Date, now = new Date()): number {
  return Math.max(0, expiresAt.getTime() - now.getTime());
}
