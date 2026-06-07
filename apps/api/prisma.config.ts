import * as dotenv from 'dotenv';
import * as path from 'path';
import { defineConfig, env } from 'prisma/config';

// Load .env from the monorepo root (two levels up from apps/api)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
