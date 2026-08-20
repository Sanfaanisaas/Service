import 'dotenv/config';
import { z } from 'zod';

const booleanEnv = z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),

  SERVER_PORT: z.coerce
      .number()
      .int()
      .positive()
      .default(5000),

  CLIENT_URL: z
      .string()
      .url()
      .default('http://localhost:3000'),

  MONGODB_URI: z
      .string()
      .min(1),

  SUPABASE_URL: z
      .string()
      .url(),

  SUPABASE_SERVICE_ROLE_KEY: z
      .string()
      .min(20),

  SANFAANI_ADMIN_EMAIL: z
      .string()
      .email()
      .optional(),

  VAPID_PUBLIC_KEY: z
      .string()
      .optional(),

  VAPID_PRIVATE_KEY: z
      .string()
      .optional(),

  VAPID_SUBJECT: z
      .string()
      .default('mailto:admin@sanfaani.ng'),

  // WhatsApp Cloud API
  WHATSAPP_ENABLED: booleanEnv,

  WHATSAPP_GRAPH_API_VERSION: z
      .string()
      .trim()
      .optional(),

  WHATSAPP_PHONE_NUMBER_ID: z
      .string()
      .trim()
      .optional(),

  WHATSAPP_ACCESS_TOKEN: z
      .string()
      .trim()
      .optional(),

  WHATSAPP_RECEIPT_TEMPLATE_NAME: z
      .string()
      .trim()
      .default('sanfaani_receipt'),

  WHATSAPP_RECEIPT_TEMPLATE_LANGUAGE: z
      .string()
      .trim()
      .default('en'),
});

const result = schema.safeParse(process.env);

if (!result.success) {
  const fields = result.error.issues
      .map((issue) => issue.path.join('.'))
      .join(', ');

  throw new Error(
      `Invalid server environment configuration: ${fields}`,
  );
}

export const env = result.data;