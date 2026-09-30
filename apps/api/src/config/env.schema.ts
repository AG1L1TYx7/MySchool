import { z } from 'zod';

const boolFromString = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean'
      ? v
      : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
  );

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(5000),

    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (u) => u.startsWith('mysql://'),
        'DATABASE_URL must start with mysql://',
      ),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_ISSUER: z.string().default('SmartSchoolApi'),
    JWT_AUDIENCE: z.string().default('SmartSchoolClients'),
    JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().positive().default(15),
    JWT_REMEMBER_ME_TTL_DAYS: z.coerce.number().int().positive().default(30),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
    /** Optional base64 32-byte key for field encryption (TOTP secrets); derived from JWT_SECRET when unset. */
    ENCRYPTION_KEY: z.string().optional(),

    AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),
    AI_SERVICE_API_KEY: z.string().optional().default(''),
    AI_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    AI_SERVICE_GENERATION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(120_000),
    AI_CALLBACK_TOKEN: z
      .string()
      .min(16, 'AI_CALLBACK_TOKEN must be at least 16 characters'),

    REDIS_URL: z.string().optional().default(''),

    CORS_ORIGINS: csv,

    UPLOAD_DIR: z.string().default('./uploads'),
    MAX_FILE_SIZE_MB: z.coerce.number().positive().default(10),
    ALLOWED_EXTENSIONS: csv,

    SMTP_HOST: z.string().optional().default(''),
    SMTP_PORT: z.coerce.number().int().positive().default(25),
    MAIL_FROM: z.string().default('noreply@smartschool.local'),
    MAIL_FROM_NAME: z.string().default('SmartSchool'),
    SENDGRID_API_KEY: z.string().optional().default(''),
    TWILIO_ACCOUNT_SID: z.string().optional().default(''),
    TWILIO_AUTH_TOKEN: z.string().optional().default(''),
    TWILIO_PHONE_NUMBER: z.string().optional().default(''),
    FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional().default(''),
    STRIPE_SECRET_KEY: z.string().optional().default(''),
    STRIPE_PUBLISHABLE_KEY: z.string().optional().default(''),
    STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
    RECAPTCHA_SITE_KEY: z.string().optional().default(''),
    RECAPTCHA_SECRET_KEY: z.string().optional().default(''),
    RECAPTCHA_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.5),

    TENANT_REQUIRED: boolFromString.default(false),
    TENANT_BASE_DOMAIN: z.string().default('localhost'),

    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
      .default('info'),
  })
  .superRefine((env, ctx) => {
    // Placeholder secrets are refused outside development (ADR-012).
    if (env.NODE_ENV === 'production') {
      for (const key of ['JWT_SECRET', 'AI_CALLBACK_TOKEN'] as const) {
        if (/CHANGE_ME/i.test(env[key])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} still has its placeholder value`,
          });
        }
      }
      if (/CHANGE_ME/.test(env.DATABASE_URL)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL still has its placeholder password',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule.forRoot({ validate }). Throws a readable error listing every problem. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
