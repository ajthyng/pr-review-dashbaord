# PR Review Dashboard — Plan 1: Monorepo Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a Turborepo monorepo with a NestJS API app and a React (Vite) web app, a shared TypeScript config package, a working health check endpoint (TDD), NestJS configured to serve the React static bundle, and a production Dockerfile.

**Architecture:** The NestJS API serves both the REST API (under `/api/*`) and the React SPA static files from a single process. In development, Vite runs its own dev server and proxies `/api` calls to NestJS. In production, a single Docker container runs NestJS which serves the pre-built React bundle from its `public/` directory.

**Tech Stack:** Node 20, npm workspaces, Turborepo, NestJS, React, Vite, TypeScript, `@nestjs/config`, `@nestjs/swagger`, `@nestjs/serve-static`, Vitest (API and web)

---

## File Map

```
pr-review-dashboard/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── health/
│   │   │   │   ├── health.controller.spec.ts   # unit test
│   │   │   │   ├── health.controller.ts
│   │   │   │   └── health.module.ts
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   ├── test/
│   │   │   ├── setup.ts                        # reflect-metadata bootstrap for NestJS decorators
│   │   │   └── health.e2e-spec.ts
│   │   ├── public/
│   │   │   └── .gitkeep                        # ensures dir exists for ServeStaticModule
│   │   ├── nest-cli.json
│   │   ├── vitest.config.ts                    # unit test config
│   │   ├── vitest.e2e.config.ts                # e2e test config
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsconfig.build.json
│   └── web/
│       ├── src/
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── index.html
│       ├── vite.config.ts                      # includes vitest config inline
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── typescript-config/
│       ├── base.json
│       ├── nestjs.json
│       ├── react.json
│       └── package.json
├── Dockerfile
├── .dockerignore
├── .env.example
├── .gitignore
├── turbo.json
└── package.json
```

---

## Task 1: Create monorepo root

**Files:**
- Create: `package.json`
- Create: `turbo.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "pr-review-dashboard",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "test": "turbo test",
    "lint": "turbo lint"
  },
  "engines": {
    "node": ">=20.0.0",
    "npm": ">=10.0.0"
  }
}
```

- [ ] **Step 2: Install Turborepo**

```bash
npm install --save-dev turbo
```

Expected: `package.json` gains a `devDependencies` entry for `turbo` at the latest version. `package-lock.json` is created.

- [ ] **Step 3: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "outputs": []
    },
    "test:e2e": {
      "dependsOn": ["build"],
      "outputs": []
    },
    "lint": {
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules
dist
.env
.env.local
coverage
*.log
.turbo
apps/web/dist
apps/api/public/*
!apps/api/public/.gitkeep
```

- [ ] **Step 5: Create `.env.example`**

```
# Server
PORT=3000
NODE_ENV=development

# Session (added in Plan 3)
# SESSION_SECRET=change-me-in-production

# Database (added in Plan 2)
# DATABASE_URL=postgresql://user:password@localhost:5432/pr_review

# Redis (added in Plan 3)
# REDIS_URL=redis://localhost:6379

# GitHub OAuth App (added in Plan 3)
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=
# GITHUB_CALLBACK_URL=http://localhost:3000/api/auth/github/callback

# GitHub App (added in Plan 4)
# GITHUB_APP_ID=
# GITHUB_APP_PRIVATE_KEY=
# GITHUB_APP_INSTALLATION_ID=
# GITHUB_ORG=

# Sync (added in Plan 4)
# SYNC_INTERVAL_SECONDS=900
# SYNC_LOOKBACK_DAYS=90

# Admin (added in Plan 3)
# ADMIN_GITHUB_USERS=your-github-username
```

- [ ] **Step 6: Commit**

```bash
git init
git add package.json package-lock.json turbo.json .gitignore .env.example
git commit -m "chore: initialize turborepo monorepo [NOJIRA]"
```

---

## Task 2: Shared TypeScript config package

**Files:**
- Create: `packages/typescript-config/package.json`
- Create: `packages/typescript-config/base.json`
- Create: `packages/typescript-config/nestjs.json`
- Create: `packages/typescript-config/react.json`

- [ ] **Step 1: Create `packages/typescript-config/package.json`**

```json
{
  "name": "@pr-review/typescript-config",
  "version": "0.0.0",
  "private": true,
  "exports": {
    "./base.json": "./base.json",
    "./nestjs.json": "./nestjs.json",
    "./react.json": "./react.json"
  }
}
```

- [ ] **Step 2: Create `packages/typescript-config/base.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Create `packages/typescript-config/nestjs.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "target": "ES2021",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "sourceMap": true,
    "outDir": "./dist",
    "incremental": true,
    "moduleResolution": "node"
  }
}
```

- [ ] **Step 4: Create `packages/typescript-config/react.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/
git commit -m "chore: add shared typescript config package [NOJIRA]"
```

---

## Task 3: Scaffold NestJS API app

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/tsconfig.build.json`
- Create: `apps/api/nest-cli.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/vitest.e2e.config.ts`
- Create: `apps/api/test/setup.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/public/.gitkeep`

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@pr-review/api",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "start:prod": "node dist/main",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "vitest run --config ./vitest.e2e.config.ts",
    "lint": "eslint \"{src,test}/**/*.ts\" --fix"
  }
}
```

- [ ] **Step 2: Install API runtime dependencies**

```bash
npm install --save @nestjs/common @nestjs/config @nestjs/core @nestjs/platform-express @nestjs/serve-static @nestjs/swagger reflect-metadata rxjs swagger-ui-express -w @pr-review/api
```

Expected: `apps/api/package.json` gains a `dependencies` block with these packages at their latest versions.

- [ ] **Step 3: Install API dev dependencies**

```bash
npm install --save-dev @nestjs/cli @nestjs/schematics @nestjs/testing @pr-review/typescript-config @types/express @types/node @types/supertest supertest ts-loader ts-node tsconfig-paths typescript vitest @vitest/coverage-v8 -w @pr-review/api
```

Expected: `apps/api/package.json` gains a `devDependencies` block.

- [ ] **Step 4: Create `apps/api/tsconfig.json`**

```json
{
  "extends": "@pr-review/typescript-config/nestjs.json",
  "compilerOptions": {
    "outDir": "./dist",
    "baseUrl": "./"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test", "**/*spec.ts"]
}
```

- [ ] **Step 5: Create `apps/api/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
```

- [ ] **Step 6: Create `apps/api/nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 7: Create `apps/api/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
```

- [ ] **Step 8: Create `apps/api/vitest.e2e.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
```

- [ ] **Step 9: Create `apps/api/test/setup.ts`**

NestJS decorators require `reflect-metadata` to be imported before any decorated class is loaded.

```typescript
import 'reflect-metadata';
```

- [ ] **Step 10: Create `apps/api/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/api/(.*)'],
    }),
  ],
})
export class AppModule {}
```

- [ ] **Step 11: Create `apps/api/src/main.ts`**

```typescript
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  const swaggerConfig = new DocumentBuilder()
    .setTitle('PR Review Dashboard')
    .setDescription('API for the PR Review Dashboard')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
}

bootstrap();
```

- [ ] **Step 12: Create `apps/api/public/.gitkeep`**

Create an empty file at `apps/api/public/.gitkeep`. This directory must exist at startup because `ServeStaticModule` throws if `rootPath` is missing.

- [ ] **Step 13: Verify NestJS compiles**

```bash
npm run build -w @pr-review/api
```

Expected: `apps/api/dist/` is created with compiled JS files. No TypeScript errors.

- [ ] **Step 14: Commit**

```bash
git add apps/api/
git commit -m "chore: scaffold nestjs api app [NOJIRA]"
```

---

## Task 4: Health check endpoint (TDD)

**Files:**
- Create: `apps/api/src/health/health.controller.spec.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/src/health/health.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/health/health.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('returns { status: ok }', () => {
    expect(controller.check()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm run test -w @pr-review/api -- health.controller
```

Expected: FAIL — `Cannot find module './health.controller'`

- [ ] **Step 3: Implement the controller**

Create `apps/api/src/health/health.controller.ts`:

```typescript
import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({
    schema: { properties: { status: { type: 'string', example: 'ok' } } },
  })
  check(): { status: string } {
    return { status: 'ok' };
  }
}
```

- [ ] **Step 4: Create the health module**

Create `apps/api/src/health/health.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

- [ ] **Step 5: Register HealthModule in AppModule**

Update `apps/api/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/api/(.*)'],
    }),
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 6: Run the test and verify it passes**

```bash
npm run test -w @pr-review/api -- health.controller
```

Expected: PASS — `✓ HealthController > returns { status: ok }`

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/health/ apps/api/src/app.module.ts
git commit -m "feat: add health check endpoint [NOJIRA]"
```

---

## Task 5: E2E test for health endpoint

**Files:**
- Create: `apps/api/test/health.e2e-spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `apps/api/test/health.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import supertest from 'supertest';
import { AppModule } from '../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns 200 with ok status', async () => {
    await supertest(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok' });
  });
});
```

- [ ] **Step 2: Run the e2e test**

```bash
npm run test:e2e -w @pr-review/api
```

Expected: PASS — `✓ Health (e2e) > GET /api/health returns 200 with ok status`

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/
git commit -m "test: add health check e2e test [NOJIRA]"
```

---

## Task 6: Scaffold React web app

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@pr-review/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc && vite build",
    "dev": "vite",
    "preview": "vite preview",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

- [ ] **Step 2: Install web runtime dependencies**

```bash
npm install --save react react-dom -w @pr-review/web
```

Expected: `apps/web/package.json` gains a `dependencies` block.

- [ ] **Step 3: Install web dev dependencies**

```bash
npm install --save-dev @pr-review/typescript-config @types/react @types/react-dom @vitejs/plugin-react typescript vite vitest @vitest/coverage-v8 jsdom -w @pr-review/web
```

Expected: `apps/web/package.json` gains a `devDependencies` block.

- [ ] **Step 4: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "@pr-review/typescript-config/react.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {}
  },
  "include": ["src"],
  "references": []
}
```

- [ ] **Step 5: Create `apps/web/vite.config.ts`**

Vitest config lives inline here so Vite and Vitest share the same plugin setup.

```typescript
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
```

- [ ] **Step 6: Create `apps/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PR Review Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `apps/web/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 8: Create `apps/web/src/App.tsx`**

```tsx
export default function App() {
  return <div>PR Review Dashboard</div>;
}
```

- [ ] **Step 9: Verify the web app builds**

```bash
npm run build -w @pr-review/web
```

Expected: `apps/web/dist/` is created with `index.html` and bundled assets. No TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add apps/web/
git commit -m "chore: scaffold react vite web app [NOJIRA]"
```

---

## Task 7: Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

The build process:
1. Install all dependencies once
2. Build the React app → `apps/web/dist/`
3. Copy the React build into `apps/api/public/` (where `ServeStaticModule` reads it)
4. Build the NestJS app → `apps/api/dist/`
5. Production stage: reinstall only prod deps, copy built artifacts

- [ ] **Step 1: Create `Dockerfile`**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app

# Copy manifests first for layer caching
COPY package*.json turbo.json ./
COPY packages/ ./packages/
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/

RUN npm ci

# Copy source
COPY apps/api ./apps/api
COPY apps/web ./apps/web

# Build web, copy output into API public dir, then build API
RUN npm run build -w @pr-review/web
RUN cp -r apps/web/dist/. apps/api/public/
RUN npm run build -w @pr-review/api

# Production stage — reinstall only prod deps to keep image small
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json turbo.json ./
COPY packages/ ./packages/
COPY apps/api/package*.json ./apps/api/
RUN npm ci --omit=dev

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/public ./apps/api/public

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
```

- [ ] **Step 2: Create `.dockerignore`**

```
.git
.env
.env.local
node_modules
apps/*/node_modules
apps/*/dist
apps/api/public/*
!apps/api/public/.gitkeep
coverage
*.log
.turbo
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "chore: add production dockerfile [NOJIRA]"
```

---

## Task 8: Verify full build

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: All test suites pass. Output includes `✓ src/health/health.controller.spec.ts > HealthController > returns { status: ok }`.

- [ ] **Step 2: Run full Turborepo build**

```bash
npm run build
```

Expected: Both `apps/api/dist/` and `apps/web/dist/` are produced. No TypeScript errors.

- [ ] **Step 3: Verify Swagger UI is accessible**

```bash
npm run dev -w @pr-review/api &
sleep 3
curl -s http://localhost:3000/api/docs-json | head -5
kill %1
```

Expected: JSON beginning with `{"openapi":"3.0.0","info":{"title":"PR Review Dashboard"`.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: verify foundation builds and tests pass [NOJIRA]"
```

---

## Self-Review Checklist

- [x] Turborepo monorepo with npm workspaces — Task 1
- [x] No pinned versions in plan — all deps installed via `npm install` commands — Tasks 1, 3, 6
- [x] Shared TypeScript config package — Task 2
- [x] NestJS app with `@nestjs/config`, `@nestjs/swagger`, `@nestjs/serve-static` — Task 3
- [x] Vitest for API unit tests (`vitest.config.ts` + `test/setup.ts` for reflect-metadata) — Task 3
- [x] Vitest for API e2e tests (`vitest.e2e.config.ts`) — Task 3, 5
- [x] Health check endpoint, unit tested (TDD) — Task 4
- [x] Health check e2e tested with supertest — Task 5
- [x] React + Vite web app — Task 6
- [x] Vitest inline in `vite.config.ts` with jsdom environment — Task 6
- [x] Vite dev server proxies `/api` to NestJS — Task 6
- [x] Production Dockerfile (multi-stage, NestJS serves React bundle) — Task 7
- [x] `.env.example` documents all future env vars — Task 1
- [x] `apps/api/public/.gitkeep` prevents `ServeStaticModule` startup error — Task 3
