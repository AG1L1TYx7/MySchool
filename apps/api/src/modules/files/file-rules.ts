import path from 'node:path';

/** Extensions accepted when ALLOWED_EXTENSIONS is not configured. */
export const DEFAULT_ALLOWED_EXTENSIONS: readonly string[] = [
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'txt',
  'md',
  'csv',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'mp3',
  'mp4',
  'webm',
  'zip',
];

/** Extensions never accepted regardless of configuration (executable or server-interpreted). */
const FORBIDDEN_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe',
  'bat',
  'cmd',
  'com',
  'msi',
  'scr',
  'ps1',
  'sh',
  'js',
  'mjs',
  'vbs',
  'jar',
  'php',
  'asp',
  'aspx',
  'jsp',
  'html',
  'htm',
  'dll',
]);

/** Lower-case extension without the dot, or empty when there is none. */
export function extensionOf(name: string): string {
  const ext = path.extname(name).toLowerCase().replace(/^\./, '');
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

export function isAllowedExtension(
  ext: string,
  allowed: readonly string[],
): boolean {
  if (!ext || FORBIDDEN_EXTENSIONS.has(ext)) return false;
  const list = allowed.length
    ? allowed.map((e) => e.toLowerCase().replace(/^\./, ''))
    : DEFAULT_ALLOWED_EXTENSIONS;
  return list.includes(ext);
}

/** Strips directories and control characters, collapses whitespace, caps the length, keeps the extension. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .split('')
    .filter(
      (c) =>
        c.charCodeAt(0) >= 32 &&
        c.charCodeAt(0) !== 127 &&
        !'"<>:|?*'.includes(c),
    )
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const ext = extensionOf(cleaned);
  const stem =
    (ext ? cleaned.slice(0, -(ext.length + 1)) : cleaned)
      .replace(/\.+$/, '')
      .trim() || 'file';
  return (stem.slice(0, 150) + (ext ? '.' + ext : '')).trim();
}

/** Relative storage path: <org>/<yyyy>/<mm>/<id>.<ext>; the id is random so names never collide or leak. */
export function storagePath(
  organizationId: string | null,
  id: string,
  ext: string,
  now = new Date(),
): string {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return path.posix.join(
    organizationId ?? 'shared',
    yyyy,
    mm,
    ext ? `${id}.${ext}` : id,
  );
}

/** The media type a download is served with comes from the allow-listed extension, never from the uploader's claim (docs/21 F22). */
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  zip: 'application/zip',
  json: 'application/json',
  xml: 'application/xml',
};

export function mimeTypeFor(fileName: string): string {
  return MIME_BY_EXTENSION[extensionOf(fileName)] ?? 'application/octet-stream';
}

/** Content-Disposition value that is safe for any file name (RFC 6266 / 5987). */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
