import { z } from 'zod';

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3001'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  // Database (Supabase)
  SUPABASE_URL: z.string().url({ message: 'Missing SUPABASE_URL' }),
  SUPABASE_ANON_KEY: z.string().min(1, { message: 'Missing SUPABASE_ANON_KEY' }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, { message: 'Missing SUPABASE_SERVICE_ROLE_KEY' }),

  // Auth
  JWT_SECRET: z.string().min(1, { message: 'Missing JWT_SECRET' }),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Admin
  ADMIN_API_KEY: z.string().min(1, { message: 'Missing ADMIN_API_KEY' }),

  // Email / SMTP
  SMTP_HOST: z.string().min(1, { message: 'Missing SMTP_HOST' }),
  SMTP_PORT: z.string().min(1, { message: 'Missing SMTP_PORT' }),
  SMTP_USER: z.string().min(1, { message: 'Missing SMTP_USER' }),
  SMTP_PASS: z.string().min(1, { message: 'Missing SMTP_PASS' }),

  // Stellar / Soroban (required — server crashes without these)
  STELLAR_NETWORK_URL: z.string().url({ message: 'Missing STELLAR_NETWORK_URL' }),
  SOROBAN_CONTRACT_ADDRESS: z.string().min(1, { message: 'Missing SOROBAN_CONTRACT_ADDRESS' }),

  // Optional Stellar config
  SOROBAN_RPC_URL: z.string().url().optional(),
  STELLAR_SECRET_KEY: z.string().optional(),
  STELLAR_NETWORK_PASSPHRASE: z.string().optional(),

  // Payment providers (optional)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(),

  // Google / Gmail (optional)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),

  // Microsoft / Outlook (optional)
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().optional(),
  MICROSOFT_REDIRECT_URI: z.string().url().optional(),

  // Encryption
  ENCRYPTION_KEY: z.string().optional(),

  // Redis (optional)
  REDIS_URL: z.string().url().optional(),
  RATE_LIMIT_REDIS_URL: z.string().url().optional(),
  RATE_LIMIT_REDIS_ENABLED: z.string().optional(),

  // Push notifications (optional)
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  // Telegram (optional)
  TELEGRAM_BOT_TOKEN: z.string().optional(),

  // Sentry (optional)
  SENTRY_DSN: z.string().optional(),

  // Anthropic (optional)
  ANTHROPIC_API_KEY: z.string().optional(),
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.message || issue.path.join('.')}`)
      .join('\n');

    console.error(`\n❌ Environment validation failed:\n${errors}\n`);
    process.exit(1);
  }

  return result.data;
}

// Skip validation in test environment to avoid requiring all vars in unit tests
export const env = process.env.NODE_ENV === 'test'
  ? (process.env as unknown as z.infer<typeof envSchema>)
  : validateEnv();
