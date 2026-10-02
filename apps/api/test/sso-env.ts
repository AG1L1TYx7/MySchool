/**
 * Must be imported before AppModule: points Google sign-in at a local stub identity provider and gives it
 * credentials, so the SSO flow can be exercised end to end without the internet.
 */
export const SSO_STUB_PORT = 18865 + Number(process.env.JEST_WORKER_ID ?? 0);
process.env.SSO_GOOGLE_BASE_URL = `http://127.0.0.1:${SSO_STUB_PORT}`;
process.env.SSO_GOOGLE_CLIENT_ID = 'e2e-google-client';
process.env.SSO_GOOGLE_CLIENT_SECRET = 'e2e-google-secret';
