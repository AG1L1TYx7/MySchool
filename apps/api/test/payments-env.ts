/**
 * Must be imported before AppModule: the config module validates the environment when it is imported,
 * so the fixture payment provider (a local server standing in for Stripe) has to be in place by then.
 */
// One port per Jest worker so suites running in parallel never collide.
export const PAYMENTS_STUB_PORT =
  18965 + Number(process.env.JEST_WORKER_ID ?? 0);
process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
process.env.STRIPE_BASE_URL = `http://127.0.0.1:${PAYMENTS_STUB_PORT}`;
process.env.STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET || 'whsec_fixture_0123456789';
