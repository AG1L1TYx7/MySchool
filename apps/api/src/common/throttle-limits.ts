/**
 * Per-route rate limits for work that costs far more than an ordinary request (docs/21 F10): exports that
 * gather a student's whole record, PDF rendering, searches that call the AI service, sandbox runs and
 * probes that make outbound calls. They sit under the global limit and count per client address.
 */
const MINUTE = 60_000;

/** Record exports, state exports, PDFs. */
export const EXPORT_LIMIT = { default: { limit: 20, ttl: MINUTE } };
/** Semantic search through the AI service. */
export const SEARCH_LIMIT = { default: { limit: 60, ttl: MINUTE } };
/** Sandbox runs of student code. */
export const CODE_RUN_LIMIT = { default: { limit: 30, ttl: MINUTE } };
/** Webhook test deliveries and on-demand health checks: each makes outbound calls. */
export const PROBE_LIMIT = { default: { limit: 30, ttl: MINUTE } };
