import { StatusView } from './status-view';
import type { StatusPage } from '@/lib/billing';

/**
 * The public status page renders its last known state on the server, so the first paint carries the
 * answer instead of a spinner (slice 28). The server asks the API at most every thirty seconds and keeps
 * serving the previous answer while the API is unreachable; the client view then refreshes every minute.
 */
export const dynamic = 'force-dynamic';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:5000';

async function lastKnown(): Promise<StatusPage | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/status`, { next: { revalidate: 30 }, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as StatusPage;
  } catch {
    return null;
  }
}

export default async function StatusPagePage() {
  const initial = await lastKnown();
  return <StatusView initial={initial} />;
}
