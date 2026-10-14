/**
 * Only a path inside this app is honoured as a destination after sign-in (docs/21 F20): it must start with
 * one slash, not two (`//evil.example` is a protocol-relative URL), carry no backslash and stay short.
 * The API applies the same rule in sso-rules.ts.
 */
export function safePath(raw: string | null | undefined, fallback = '/dashboard'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.length > 300) return fallback;
  return raw;
}
