import { lookup } from 'node:dns/promises';

/**
 * Rules for URLs the server will connect to on an administrator's say-so (webhooks, roster sources, LTI
 * key sets): https only outside development, no credentials in the URL, and never an address inside the
 * deployment's own network (docs/21 F08). The pure checks are exported for tests; `assertPublicHttpUrl`
 * adds the DNS lookup and is called where the URL is stored and again before every fetch.
 */

export interface OutboundUrlOptions {
  /** Development and tests may call plain http on the loopback host. */
  allowLoopback?: boolean;
}

export class OutboundUrlError extends Error {
  readonly code = 'url.not_allowed';
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((x) => x > 255)) return null;
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
}

const PRIVATE_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

/** True for loopback, private, link-local, carrier-grade NAT, multicast, reserved and metadata addresses. */
export function isPrivateAddress(ip: string): boolean {
  let v = ip.trim().toLowerCase();
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) v = mapped[1];
  const n = ipv4ToInt(v);
  if (n !== null) {
    return PRIVATE_V4.some(([base, bits]) => {
      const b = ipv4ToInt(base) as number;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (n & mask) >>> 0 === (b & mask) >>> 0;
    });
  }
  if (!v.includes(':')) return false;
  if (v === '::' || v === '::1') return true;
  const first = parseInt(v.split(':')[0] || '0', 16);
  if (Number.isNaN(first)) return true;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** The syntactic part: scheme, no credentials, no literal private address, loopback only when allowed. */
export function checkOutboundUrl(
  url: string,
  options: OutboundUrlOptions = {},
): { ok: true; hostname: string } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (u.username || u.password)
    return { ok: false, reason: 'credentials in the URL are not allowed' };
  const host = u.hostname.toLowerCase();
  const loopback = LOOPBACK_HOSTS.has(host);
  if (u.protocol === 'http:') {
    if (!(options.allowLoopback && loopback))
      return { ok: false, reason: 'must use https' };
    return { ok: true, hostname: host };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'must use https' };
  if (loopback)
    return options.allowLoopback
      ? { ok: true, hostname: host }
      : { ok: false, reason: 'loopback addresses are not allowed' };
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return { ok: false, reason: 'internal host names are not allowed' };
  }
  const literal = host.startsWith('[') ? host.slice(1, -1) : host;
  if (/^[\d.]+$|:/.test(literal) && isPrivateAddress(literal))
    return { ok: false, reason: 'private addresses are not allowed' };
  return { ok: true, hostname: host };
}

/**
 * Syntactic check plus a DNS lookup: every address the name resolves to must be public. Called where a
 * URL is accepted and again right before it is fetched, so a name that later points inside is refused then.
 */
export async function assertPublicHttpUrl(
  url: string,
  options: OutboundUrlOptions = {},
): Promise<void> {
  const check = checkOutboundUrl(url, options);
  if (!check.ok) throw new OutboundUrlError(`${url}: ${check.reason}`);
  if (options.allowLoopback && LOOPBACK_HOSTS.has(check.hostname)) return;
  const literal = check.hostname.startsWith('[')
    ? check.hostname.slice(1, -1)
    : check.hostname;
  if (/^[\d.]+$|:/.test(literal)) return; // a literal public address was already checked
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(check.hostname, { all: true });
  } catch {
    throw new OutboundUrlError(`${url}: the host name does not resolve`);
  }
  if (addresses.length === 0)
    throw new OutboundUrlError(`${url}: the host name does not resolve`);
  const inside = addresses.find((a) => isPrivateAddress(a.address));
  if (inside)
    throw new OutboundUrlError(
      `${url}: resolves to an address inside the network (${inside.address})`,
    );
}

/**
 * Reads a response body as text while refusing anything larger than `maxBytes`: a key set or token
 * response that a remote party controls must not be allowed to fill memory.
 */
export async function readBoundedText(
  res: Response,
  maxBytes: number,
): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes)
    throw new OutboundUrlError(`response larger than ${maxBytes} bytes`);
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new OutboundUrlError(`response larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
