/**
 * Must be imported before AppModule: the config module validates the environment when
 * it is imported, so the stub AI service address has to be in place by then.
 */
// One port per Jest worker so suites running in parallel never collide.
export const AI_STUB_PORT = 18765 + Number(process.env.JEST_WORKER_ID ?? 0);
export const AI_STUB_TOKEN = 'e2e-ai-service-token';
process.env.AI_SERVICE_URL = `http://127.0.0.1:${AI_STUB_PORT}`;
process.env.AI_SERVICE_API_KEY = AI_STUB_TOKEN;
process.env.AI_TUTOR_DAILY_LIMIT = '4';
