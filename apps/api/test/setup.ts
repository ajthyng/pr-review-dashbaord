import 'reflect-metadata';
import { resolve } from 'path';
import { config } from 'dotenv';

// Load the root .env so ConfigModule picks up DATABASE_URL during e2e tests
config({ path: resolve(__dirname, '../../../.env') });
