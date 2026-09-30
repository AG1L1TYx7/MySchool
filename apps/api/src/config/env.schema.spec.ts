import { validateEnv } from './env.schema';

const valid = {
  DATABASE_URL: 'mysql://smartschool:pw@127.0.0.1:3306/smartschooldb',
  JWT_SECRET: 'x'.repeat(48),
  AI_CALLBACK_TOKEN: 'y'.repeat(24),
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(valid);
    expect(env.PORT).toBe(5000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.AI_SERVICE_URL).toBe('http://localhost:8000');
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.TENANT_REQUIRED).toBe(false);
  });

  it('parses comma-separated lists and booleans', () => {
    const env = validateEnv({
      ...valid,
      CORS_ORIGINS: 'http://a, http://b ,',
      TENANT_REQUIRED: 'true',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://a', 'http://b']);
    expect(env.TENANT_REQUIRED).toBe(true);
  });

  it('rejects a short JWT secret with a readable message', () => {
    expect(() => validateEnv({ ...valid, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('rejects non-mysql database URLs', () => {
    expect(() =>
      validateEnv({ ...valid, DATABASE_URL: 'postgres://x' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('refuses placeholder secrets in production only', () => {
    const placeholder = {
      ...valid,
      JWT_SECRET: 'CHANGE_ME_TO_A_LONG_RANDOM_VALUE_______',
    };
    expect(() =>
      validateEnv({ ...placeholder, NODE_ENV: 'development' }),
    ).not.toThrow();
    expect(() =>
      validateEnv({ ...placeholder, NODE_ENV: 'production' }),
    ).toThrow(/placeholder/);
  });
});
