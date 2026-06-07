# PR Review Dashboard — Plan 2: Data Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define and migrate the full PostgreSQL schema for all entities, wire up a NestJS PrismaService, and provide a docker-compose for local development.

**Architecture:** Prisma manages the schema as a single source of truth and generates a type-safe client. NestJS wraps it in a global `PrismaModule`/`PrismaService` that owns the connection lifecycle (`$connect` on init, `$disconnect` on destroy). All six models are defined here — even those used in later plans — because they need to co-evolve with migrations rather than being added piecemeal.

**Tech Stack:** Prisma 5, PostgreSQL 16 (docker-compose for local dev), `@prisma/client` (runtime), `prisma` CLI (dev dep)

---

## Design Decisions (from grill-me session)

- **ORM:** Prisma (schema-first, strong type inference, `prisma migrate`)
- **Session storage:** Redis — NOT in Postgres. No `Session` model here; that's Plan 3.
- **Admin role:** Seeded from `ADMIN_GITHUB_USERS` env var on startup (Plan 3). The `isAdmin` column lives on `User` here.
- **Sync tracking:** `Repo.syncedAt` tracks per-repo last sync. `SyncLog` tracks each sync run for observability.
- **Review decision:** Denormalized onto `PullRequest.reviewDecision` so the PR list query doesn't need a join.
- **CI status:** Denormalized onto `PullRequest.ciStatus` (set from GitHub check runs during sync).
- **User allowlist:** Per-user repo allowlist for UI filtering. Stored as a composite-PK join table.

---

## File Map

```
apps/api/
├── prisma/
│   └── schema.prisma                  # All models + enums + datasource
├── src/
│   └── prisma/
│       ├── prisma.module.ts            # Global NestJS module, exports PrismaService
│       └── prisma.service.ts           # Extends PrismaClient, owns connect/disconnect
│       └── prisma.service.spec.ts      # Unit test — instanceof checks, lifecycle methods
├── test/
│   └── prisma.e2e-spec.ts             # E2E — verifies real DB connection
└── package.json                        # Add prisma scripts + update build script

docker-compose.yml                      # Root — postgres:16-alpine for local dev
.env.example                            # Uncomment DATABASE_URL
Dockerfile                              # Copy .prisma generated client to runner stage
```

---

## Task 1: Local dev infrastructure

**Files:**
- Create: `docker-compose.yml`
- Modify: `.env.example`

- [ ] **Step 1: Create `docker-compose.yml` at the repo root**

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: pr_review
      POSTGRES_USER: pr_review
      POSTGRES_PASSWORD: pr_review
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pr_review"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

- [ ] **Step 2: Uncomment `DATABASE_URL` in `.env.example`**

The current `.env.example` has `DATABASE_URL` commented out. Replace the commented line:

Old:
```
# DATABASE_URL=postgresql://user:password@localhost:5432/pr_review
```

New:
```
DATABASE_URL=postgresql://pr_review:pr_review@localhost:5432/pr_review
```

- [ ] **Step 3: Start postgres and verify it accepts connections**

```bash
docker compose up -d db
docker compose exec db pg_isready -U pr_review
```

Expected output: `/var/run/postgresql:5432 - accepting connections`

- [ ] **Step 4: Create a local `.env` from the example**

```bash
cp .env.example .env
```

The `.env` is gitignored. This is the file that `@nestjs/config` and the `prisma` CLI will read from.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore: add postgres docker-compose and database env var [NOJIRA]"
```

---

## Task 2: Install Prisma and write the schema

**Files:**
- Create: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Install Prisma dependencies in the API workspace**

```bash
npm install --save-dev prisma -w @pr-review/api
npm install --save @prisma/client -w @pr-review/api
```

Expected: `apps/api/package.json` gains `prisma` in devDependencies and `@prisma/client` in dependencies.

- [ ] **Step 2: Add Prisma scripts and update the build script in `apps/api/package.json`**

In the `"scripts"` block, add the following entries and update `"build"`:

```json
"build": "prisma generate && nest build",
"db:generate": "prisma generate",
"db:migrate:dev": "prisma migrate dev",
"db:migrate:deploy": "prisma migrate deploy",
"db:studio": "prisma studio"
```

- [ ] **Step 3: Create `apps/api/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Enums ───────────────────────────────────────────────────────────────────

enum PrState {
  OPEN
  CLOSED
  MERGED
}

enum ReviewDecision {
  NONE
  REVIEW_REQUIRED
  CHANGES_REQUESTED
  APPROVED
}

enum CiStatus {
  NONE
  PENDING
  RUNNING
  SUCCESS
  FAILURE
}

enum ReviewState {
  APPROVED
  CHANGES_REQUESTED
  COMMENTED
  DISMISSED
}

enum SyncStatus {
  RUNNING
  COMPLETED
  FAILED
}

// ─── Models ──────────────────────────────────────────────────────────────────

model User {
  id        Int      @id @default(autoincrement())
  githubId  Int      @unique
  login     String   @unique
  name      String?
  avatarUrl String?
  isAdmin   Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  repoAllowlist UserRepoAllowlist[]
}

model Repo {
  id           Int       @id @default(autoincrement())
  githubId     Int       @unique
  fullName     String    @unique
  name         String
  isArchived   Boolean   @default(false)
  syncedAt     DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  pullRequests  PullRequest[]
  allowlistedBy UserRepoAllowlist[]
}

model UserRepoAllowlist {
  userId    Int
  repoId    Int
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  repo Repo @relation(fields: [repoId], references: [id], onDelete: Cascade)

  @@id([userId, repoId])
}

model PullRequest {
  id              Int            @id @default(autoincrement())
  githubId        Int            @unique
  repoId          Int
  number          Int
  title           String
  authorLogin     String
  authorAvatarUrl String?
  state           PrState
  isDraft         Boolean        @default(false)
  reviewDecision  ReviewDecision @default(NONE)
  ciStatus        CiStatus       @default(NONE)
  commentCount    Int            @default(0)
  commitCount     Int            @default(0)
  openedAt        DateTime
  mergedAt        DateTime?
  closedAt        DateTime?
  lastActivityAt  DateTime
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  repo    Repo     @relation(fields: [repoId], references: [id], onDelete: Cascade)
  reviews Review[]

  @@unique([repoId, number])
}

model Review {
  id                Int         @id @default(autoincrement())
  githubId          Int         @unique
  pullRequestId     Int
  reviewerLogin     String
  reviewerAvatarUrl String?
  state             ReviewState
  submittedAt       DateTime
  createdAt         DateTime    @default(now())

  pullRequest PullRequest @relation(fields: [pullRequestId], references: [id], onDelete: Cascade)
}

model SyncLog {
  id             Int        @id @default(autoincrement())
  startedAt      DateTime   @default(now())
  completedAt    DateTime?
  status         SyncStatus
  errorMessage   String?
  reposProcessed Int        @default(0)
  prsProcessed   Int        @default(0)
}
```

- [ ] **Step 4: Verify the schema parses without errors**

```bash
npm run db:generate -w @pr-review/api
```

Expected: Prisma generates the client into `node_modules/@prisma/client` with no errors. You'll see output like `✔ Generated Prisma Client`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/ apps/api/package.json package-lock.json
git commit -m "chore: add prisma schema with all models [NOJIRA]"
```

---

## Task 3: NestJS PrismaService + PrismaModule (TDD)

**Files:**
- Create: `apps/api/src/prisma/prisma.service.spec.ts`
- Create: `apps/api/src/prisma/prisma.service.ts`
- Create: `apps/api/src/prisma/prisma.module.ts`

- [ ] **Step 1: Write the failing unit test**

Create `apps/api/src/prisma/prisma.service.spec.ts`:

```typescript
import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(() => {
    service = new PrismaService();
  });

  it('extends PrismaClient', () => {
    expect(service).toBeInstanceOf(PrismaClient);
  });

  it('implements onModuleInit', () => {
    expect(typeof service.onModuleInit).toBe('function');
  });

  it('implements onModuleDestroy', () => {
    expect(typeof service.onModuleDestroy).toBe('function');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm run test -w @pr-review/api
```

Expected: FAIL — `Cannot find module './prisma.service'`

- [ ] **Step 3: Implement `PrismaService`**

Create `apps/api/src/prisma/prisma.service.ts`:

```typescript
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
npm run test -w @pr-review/api
```

Expected: PASS — all three `PrismaService` tests green.

- [ ] **Step 5: Create `PrismaModule`**

Create `apps/api/src/prisma/prisma.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

`@Global()` means any module that imports `PrismaModule` once (e.g., `AppModule`) makes `PrismaService` available everywhere without re-importing.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/prisma/
git commit -m "feat: add nestjs prisma service and module [NOJIRA]"
```

---

## Task 4: Run the initial migration

**Files:**
- Create: `apps/api/prisma/migrations/` (generated by Prisma)

The `DATABASE_URL` in your local `.env` must point to the running postgres from Task 1.

- [ ] **Step 1: Run the initial migration**

```bash
npm run db:migrate:dev -w @pr-review/api -- --name init
```

Expected output:
```
Applying migration `20260607000000_init`
Your database is now in sync with your schema.
✔ Generated Prisma Client
```

A `apps/api/prisma/migrations/` directory is created with:
- `20260607xxxxxx_init/migration.sql` — the full DDL for all tables
- `migration_lock.toml` — Prisma's lockfile for the provider

- [ ] **Step 2: Verify the tables exist in Postgres**

```bash
docker compose exec db psql -U pr_review -d pr_review -c "\dt"
```

Expected: A table list including `User`, `Repo`, `UserRepoAllowlist`, `PullRequest`, `Review`, `SyncLog`.

- [ ] **Step 3: Commit the migration files**

```bash
git add apps/api/prisma/migrations/
git commit -m "chore: add initial prisma migration [NOJIRA]"
```

---

## Task 5: Register PrismaModule in AppModule + update Dockerfile

**Files:**
- Modify: `apps/api/src/app.module.ts`
- Modify: `Dockerfile`

- [ ] **Step 1: Add `PrismaModule` to `AppModule` imports**

Open `apps/api/src/app.module.ts` and add `PrismaModule`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/api{/*path}'],
    }),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Update the Dockerfile runner stage to include the Prisma generated client**

The multi-stage Dockerfile installs only prod deps in the runner stage via `npm ci --omit=dev`. This gives a fresh `node_modules` without the generated `.prisma/client` binary (which `prisma generate` writes during the builder stage). Copy it across explicitly.

In `Dockerfile`, add one `COPY` line to the runner stage, after the existing `COPY --from=builder` lines:

```dockerfile
# Production stage — reinstall only prod deps to keep image small
FROM node:24-alpine3.23 AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json turbo.json ./
COPY packages/ ./packages/
COPY apps/api/package*.json ./apps/api/
RUN npm ci --omit=dev

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/public ./apps/api/public
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
```

- [ ] **Step 3: Verify the API compiles with PrismaModule registered**

```bash
npm run build -w @pr-review/api
```

Expected: `apps/api/dist/` updated with no TypeScript errors. The build script now runs `prisma generate && nest build` so the client is always fresh before compilation.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/app.module.ts Dockerfile
git commit -m "feat: register prisma module in app module, fix docker prisma client copy [NOJIRA]"
```

---

## Task 6: E2E test for database connectivity

**Files:**
- Create: `apps/api/test/prisma.e2e-spec.ts`

This test requires a running Postgres. Start docker-compose if it isn't already: `docker compose up -d db`

- [ ] **Step 1: Write the e2e test**

Create `apps/api/test/prisma.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PrismaService (e2e)', () => {
  let prismaService: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
      ],
    }).compile();

    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await prismaService.$disconnect();
  });

  it('connects to the database', async () => {
    await expect(prismaService.$queryRaw`SELECT 1`).resolves.toBeDefined();
  });

  it('can query the User table', async () => {
    const count = await prismaService.user.count();
    expect(typeof count).toBe('number');
  });

  it('can query the PullRequest table', async () => {
    const count = await prismaService.pullRequest.count();
    expect(typeof count).toBe('number');
  });
});
```

- [ ] **Step 2: Run the e2e test**

Make sure `DATABASE_URL` in `.env` points to the running Postgres, then:

```bash
npm run test:e2e -w @pr-review/api
```

Expected: PASS — all three e2e tests pass. Output includes `✓ PrismaService (e2e) > connects to the database`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/prisma.e2e-spec.ts
git commit -m "test: add prisma e2e connectivity test [NOJIRA]"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Prisma + PostgreSQL ORM — Task 2
- [x] All six models: `User`, `Repo`, `UserRepoAllowlist`, `PullRequest`, `Review`, `SyncLog` — Task 2
- [x] All enums: `PrState`, `ReviewDecision`, `CiStatus`, `ReviewState`, `SyncStatus` — Task 2
- [x] `isAdmin` on `User` (seeded later in Plan 3, column defined here) — Task 2
- [x] `Repo.syncedAt` for per-repo sync tracking — Task 2
- [x] `UserRepoAllowlist` composite PK join table — Task 2
- [x] `PullRequest.reviewDecision` denormalized — Task 2
- [x] `PullRequest.ciStatus` denormalized — Task 2
- [x] `SyncLog` for sync observability — Task 2
- [x] NestJS global `PrismaModule` / `PrismaService` — Task 3
- [x] Connection lifecycle: `$connect` on init, `$disconnect` on destroy — Task 3
- [x] Initial migration — Task 4
- [x] `PrismaModule` registered in `AppModule` — Task 5
- [x] Dockerfile runner stage copies `.prisma` generated client — Task 5
- [x] `docker-compose.yml` for local Postgres — Task 1
- [x] `DATABASE_URL` in `.env.example` — Task 1
- [x] E2E connectivity test — Task 6

**Placeholder scan:** No TBDs, no "add validation later", no missing code blocks.

**Type consistency:**
- `PrismaService` is imported as `PrismaService` in both the module and e2e test
- `PrismaModule` exported from `prisma.module.ts` and imported identically in `app.module.ts` and e2e test
- `prisma.pullRequest` (camelCase) used in e2e test matches Prisma's generated client accessor for the `PullRequest` model
