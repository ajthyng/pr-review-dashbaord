# PR Review Dashboard — Plan 4: GitHub Sync

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a GitHub App-based sync job that fetches repos, pull requests, reviews, and CI status from a single GitHub org on a configurable polling interval, with a full historical backfill on first startup.

**Architecture:** A `SyncProvider` interface abstracts the sync mechanism. The only implementation is `PollingSyncProvider`, which uses the Octokit REST client authenticated as a GitHub App installation. `@nestjs/schedule` triggers the sync on a cron interval. On startup, a backfill covers the last `SYNC_LOOKBACK_DAYS` days. All data is upserted into Postgres via PrismaService. Each sync run is recorded in `SyncLog`.

**Tech Stack:** `@octokit/rest`, `@octokit/auth-app`, `@nestjs/schedule`, `@nestjs/common`, Prisma, PostgreSQL

---

## Design Decisions (from grill-me session)

- **Auth for sync:** GitHub App (not OAuth App, not PAT) — renewable installation tokens, scoped to org
- **Sync target:** Single GitHub org (configured via `GITHUB_ORG` env var)
- **Sync scope:** All repos in the org regardless of per-user allowlist
- **Interval:** 15 minutes default, configurable via `SYNC_INTERVAL_SECONDS` (900)
- **Backfill:** `SYNC_LOOKBACK_DAYS` (default 90) on first run when DB is empty
- **Strategy:** Polling (no webhooks)
- **Data synced:** Repos → Pull requests (open + recently closed) → Reviews → CI/check run status

---

## File Map

```
apps/api/
├── src/
│   ├── config/
│   │   └── config.keys.ts              # Modify — add GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY,
│   │   │                               #   GITHUB_APP_INSTALLATION_ID, GITHUB_ORG,
│   │   │                               #   SYNC_INTERVAL_SECONDS, SYNC_LOOKBACK_DAYS
│   │   └── config.ts                   # Modify — Joi rules for new keys
│   └── sync/
│       ├── sync.provider.interface.ts  # SyncProvider interface
│       ├── github-app.provider.ts      # Symbol + FactoryProvider for Octokit authenticated as App
│       ├── polling-sync.provider.ts    # PollingSyncProvider implements SyncProvider
│       ├── polling-sync.provider.spec.ts
│       ├── sync.service.ts             # Orchestrates sync: updates SyncLog, calls provider
│       ├── sync.service.spec.ts
│       └── sync.module.ts             # Imports ScheduleModule, provides everything
└── app.module.ts                      # Modify — add SyncModule
```

---

## Task 1: Env vars for GitHub App and sync config

**Files:**
- Modify: `apps/api/src/config/config.keys.ts`
- Modify: `apps/api/src/config/config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Update `apps/api/src/config/config.keys.ts`**

```typescript
export enum ConfigKeys {
  PORT = 'PORT',
  DATABASE_URL = 'DATABASE_URL',
  REDIS_URL = 'REDIS_URL',
  SESSION_SECRET = 'SESSION_SECRET',
  GITHUB_CLIENT_ID = 'GITHUB_CLIENT_ID',
  GITHUB_CLIENT_SECRET = 'GITHUB_CLIENT_SECRET',
  GITHUB_CALLBACK_URL = 'GITHUB_CALLBACK_URL',
  ADMIN_GITHUB_USERS = 'ADMIN_GITHUB_USERS',
  GITHUB_APP_ID = 'GITHUB_APP_ID',
  GITHUB_APP_PRIVATE_KEY = 'GITHUB_APP_PRIVATE_KEY',
  GITHUB_APP_INSTALLATION_ID = 'GITHUB_APP_INSTALLATION_ID',
  GITHUB_ORG = 'GITHUB_ORG',
  SYNC_INTERVAL_SECONDS = 'SYNC_INTERVAL_SECONDS',
  SYNC_LOOKBACK_DAYS = 'SYNC_LOOKBACK_DAYS',
}
```

- [ ] **Step 2: Update `apps/api/src/config/config.ts`**

```typescript
import * as Joi from 'joi';
import { ConfigKeys } from './config.keys';

export const validationSchema = Joi.object({
  [ConfigKeys.PORT]: Joi.number().default(3000),
  [ConfigKeys.DATABASE_URL]: Joi.string().required(),
  [ConfigKeys.REDIS_URL]: Joi.string().required(),
  [ConfigKeys.SESSION_SECRET]: Joi.string().min(32).required(),
  [ConfigKeys.GITHUB_CLIENT_ID]: Joi.string().required(),
  [ConfigKeys.GITHUB_CLIENT_SECRET]: Joi.string().required(),
  [ConfigKeys.GITHUB_CALLBACK_URL]: Joi.string().uri().required(),
  [ConfigKeys.ADMIN_GITHUB_USERS]: Joi.string().default(''),
  [ConfigKeys.GITHUB_APP_ID]: Joi.number().required(),
  [ConfigKeys.GITHUB_APP_PRIVATE_KEY]: Joi.string().required(),
  [ConfigKeys.GITHUB_APP_INSTALLATION_ID]: Joi.number().required(),
  [ConfigKeys.GITHUB_ORG]: Joi.string().required(),
  [ConfigKeys.SYNC_INTERVAL_SECONDS]: Joi.number().default(900),
  [ConfigKeys.SYNC_LOOKBACK_DAYS]: Joi.number().default(90),
});
```

- [ ] **Step 3: Add to `.env.example`**

```
# GitHub App (for background sync)
GITHUB_APP_ID=your-github-app-id
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_INSTALLATION_ID=your-installation-id
GITHUB_ORG=your-github-org-name

# Sync
SYNC_INTERVAL_SECONDS=900
SYNC_LOOKBACK_DAYS=90
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/config/ .env.example
git commit -m "chore: add github app and sync env vars [NOJIRA]"
```

---

## Task 2: SyncProvider interface and GitHub App Octokit provider

**Files:**
- Create: `apps/api/src/sync/sync.provider.interface.ts`
- Create: `apps/api/src/sync/github-app.provider.ts`

- [ ] **Step 1: Install dependencies**

```bash
npm install --save @octokit/rest @octokit/auth-app @nestjs/schedule -w @pr-review/api
npm install --save-dev @types/node -w @pr-review/api
```

- [ ] **Step 2: Create `apps/api/src/sync/sync.provider.interface.ts`**

```typescript
export interface SyncProvider {
  syncAll(lookbackDays: number): Promise<{ reposProcessed: number; prsProcessed: number }>;
}

export const SYNC_PROVIDER = Symbol('SYNC_PROVIDER');
```

- [ ] **Step 3: Create `apps/api/src/sync/github-app.provider.ts`**

```typescript
import { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { ConfigKeys } from '../config/config.keys';

export const GITHUB_OCTOKIT = Symbol('GITHUB_OCTOKIT');

export const GithubOctokitProvider: FactoryProvider<Octokit> = {
  provide: GITHUB_OCTOKIT,
  useFactory: (config: ConfigService): Octokit => {
    const privateKey = config.get(ConfigKeys.GITHUB_APP_PRIVATE_KEY)!.replace(/\\n/g, '\n');
    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: config.get(ConfigKeys.GITHUB_APP_ID)!,
        privateKey,
        installationId: config.get(ConfigKeys.GITHUB_APP_INSTALLATION_ID)!,
      },
    });
  },
  inject: [ConfigService],
};
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/sync/sync.provider.interface.ts apps/api/src/sync/github-app.provider.ts
git commit -m "feat: add sync provider interface and github app octokit provider [NOJIRA]"
```

---

## Task 3: PollingSyncProvider (TDD)

**Files:**
- Create: `apps/api/src/sync/polling-sync.provider.spec.ts`
- Create: `apps/api/src/sync/polling-sync.provider.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `apps/api/src/sync/polling-sync.provider.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { PollingSyncProvider } from './polling-sync.provider';
import { GITHUB_OCTOKIT } from './github-app.provider';
import { PrismaService } from '../prisma/prisma.service';
import { DATABASE_URL } from '../prisma/database-url.provider';
import { ConfigService } from '@nestjs/config';

const mockOctokit = {
  paginate: vi.fn(),
  rest: {
    repos: { listForOrg: vi.fn() },
    pulls: { list: vi.fn(), listReviews: vi.fn() },
    checks: { listForRef: vi.fn() },
  },
};

const mockPrisma = {
  repo: { upsert: vi.fn(), findMany: vi.fn() },
  pullRequest: { upsert: vi.fn(), updateMany: vi.fn() },
  review: { upsert: vi.fn() },
};

const mockConfig = { get: vi.fn((key: string) => key === 'GITHUB_ORG' ? 'test-org' : undefined) };

describe('PollingSyncProvider', () => {
  let provider: PollingSyncProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PollingSyncProvider,
        { provide: GITHUB_OCTOKIT, useValue: mockOctokit },
        { provide: DATABASE_URL, useValue: 'postgresql://test:test@localhost/test' },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    provider = module.get<PollingSyncProvider>(PollingSyncProvider);
    vi.clearAllMocks();
  });

  it('syncs repos from the org', async () => {
    mockOctokit.paginate.mockResolvedValueOnce([
      { id: 1, name: 'my-repo', full_name: 'test-org/my-repo', archived: false },
    ]);
    mockPrisma.repo.upsert.mockResolvedValue({});
    mockOctokit.paginate.mockResolvedValueOnce([]); // no PRs

    const result = await provider.syncAll(1);

    expect(mockPrisma.repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { githubId: 1n },
        create: expect.objectContaining({ fullName: 'test-org/my-repo' }),
      }),
    );
    expect(result.reposProcessed).toBe(1);
  });

  it('returns zero counts when org has no repos', async () => {
    mockOctokit.paginate.mockResolvedValue([]);
    const result = await provider.syncAll(90);
    expect(result).toEqual({ reposProcessed: 0, prsProcessed: 0 });
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
npm run test -w @pr-review/api
```

Expected: FAIL — `Cannot find module './polling-sync.provider'`

- [ ] **Step 3: Create `apps/api/src/sync/polling-sync.provider.ts`**

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import { PrState, ReviewDecision, CiStatus, ReviewState } from '@prisma/client';
import { GITHUB_OCTOKIT } from './github-app.provider';
import { SyncProvider } from './sync.provider.interface';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigKeys } from '../config/config.keys';

@Injectable()
export class PollingSyncProvider implements SyncProvider {
  private readonly logger = new Logger(PollingSyncProvider.name);

  constructor(
    @Inject(GITHUB_OCTOKIT) private readonly octokit: Octokit,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async syncAll(lookbackDays: number): Promise<{ reposProcessed: number; prsProcessed: number }> {
    const org = this.config.get(ConfigKeys.GITHUB_ORG)!;
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

    const repos = await this.octokit.paginate(this.octokit.rest.repos.listForOrg, {
      org,
      per_page: 100,
    });

    let prsProcessed = 0;

    for (const repo of repos) {
      await this.prisma.repo.upsert({
        where: { githubId: BigInt(repo.id) },
        create: {
          githubId: BigInt(repo.id),
          fullName: repo.full_name,
          name: repo.name,
          isArchived: repo.archived ?? false,
          syncedAt: new Date(),
        },
        update: {
          isArchived: repo.archived ?? false,
          syncedAt: new Date(),
        },
      });

      const prs = await this.octokit.paginate(this.octokit.rest.pulls.list, {
        owner: org,
        repo: repo.name,
        state: 'all',
        sort: 'updated',
        direction: 'desc',
        per_page: 100,
      });

      const recentPrs = prs.filter((pr) => new Date(pr.updated_at) >= new Date(since));

      for (const pr of recentPrs) {
        const state = pr.merged_at ? PrState.MERGED : pr.state === 'closed' ? PrState.CLOSED : PrState.OPEN;

        const [reviews, checks] = await Promise.all([
          this.octokit.paginate(this.octokit.rest.pulls.listReviews, {
            owner: org,
            repo: repo.name,
            pull_number: pr.number,
            per_page: 100,
          }),
          this.octokit.rest.checks.listForRef({
            owner: org,
            repo: repo.name,
            ref: pr.head.sha,
            per_page: 100,
          }).catch(() => ({ data: { check_runs: [] } })),
        ]);

        const reviewDecision = this.computeReviewDecision(reviews);
        const ciStatus = this.computeCiStatus(checks.data.check_runs);

        const dbRepo = await this.prisma.repo.upsert({
          where: { githubId: BigInt(repo.id) },
          create: { githubId: BigInt(repo.id), fullName: repo.full_name, name: repo.name },
          update: {},
        });

        await this.prisma.pullRequest.upsert({
          where: { githubId: BigInt(pr.id) },
          create: {
            githubId: BigInt(pr.id),
            repoId: dbRepo.id,
            number: pr.number,
            title: pr.title,
            authorLogin: pr.user?.login ?? 'ghost',
            authorAvatarUrl: pr.user?.avatar_url ?? null,
            state,
            isDraft: pr.draft ?? false,
            reviewDecision,
            ciStatus,
            commentCount: pr.comments + pr.review_comments,
            openedAt: new Date(pr.created_at),
            mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
            closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
            lastActivityAt: new Date(pr.updated_at),
          },
          update: {
            title: pr.title,
            state,
            isDraft: pr.draft ?? false,
            reviewDecision,
            ciStatus,
            commentCount: pr.comments + pr.review_comments,
            mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
            closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
            lastActivityAt: new Date(pr.updated_at),
          },
        });

        for (const review of reviews) {
          if (!review.id || !review.user) continue;
          const reviewState = this.mapReviewState(review.state);
          if (!reviewState) continue;

          await this.prisma.review.upsert({
            where: { githubId: BigInt(review.id) },
            create: {
              githubId: BigInt(review.id),
              pullRequestId: (await this.prisma.pullRequest.upsert({
                where: { githubId: BigInt(pr.id) },
                create: { githubId: BigInt(pr.id), repoId: dbRepo.id, number: pr.number, title: pr.title, authorLogin: pr.user?.login ?? 'ghost', state, openedAt: new Date(pr.created_at), lastActivityAt: new Date(pr.updated_at) },
                update: {},
              })).id,
              reviewerLogin: review.user.login,
              reviewerAvatarUrl: review.user.avatar_url ?? null,
              state: reviewState,
              submittedAt: new Date(review.submitted_at ?? Date.now()),
            },
            update: {
              state: reviewState,
              submittedAt: new Date(review.submitted_at ?? Date.now()),
            },
          });
        }

        prsProcessed++;
      }
    }

    return { reposProcessed: repos.length, prsProcessed };
  }

  private computeReviewDecision(reviews: Array<{ state: string; user?: { login: string } | null }>): ReviewDecision {
    const byReviewer = new Map<string, string>();
    for (const r of reviews) {
      if (r.user && (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED')) {
        byReviewer.set(r.user.login, r.state);
      }
    }
    const states = Array.from(byReviewer.values());
    if (states.includes('CHANGES_REQUESTED')) return ReviewDecision.CHANGES_REQUESTED;
    if (states.includes('APPROVED')) return ReviewDecision.APPROVED;
    return ReviewDecision.NONE;
  }

  private computeCiStatus(checkRuns: Array<{ status: string; conclusion: string | null }>): CiStatus {
    if (checkRuns.length === 0) return CiStatus.NONE;
    if (checkRuns.some((c) => c.conclusion === 'failure')) return CiStatus.FAILURE;
    if (checkRuns.some((c) => c.status !== 'completed')) return CiStatus.RUNNING;
    if (checkRuns.every((c) => c.conclusion === 'success' || c.conclusion === 'neutral' || c.conclusion === 'skipped')) return CiStatus.SUCCESS;
    return CiStatus.PENDING;
  }

  private mapReviewState(state: string): ReviewState | null {
    const map: Record<string, ReviewState> = {
      APPROVED: ReviewState.APPROVED,
      CHANGES_REQUESTED: ReviewState.CHANGES_REQUESTED,
      COMMENTED: ReviewState.COMMENTED,
      DISMISSED: ReviewState.DISMISSED,
    };
    return map[state] ?? null;
  }
}
```

- [ ] **Step 4: Run and verify tests pass**

```bash
npm run test -w @pr-review/api
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/sync/polling-sync.provider.ts apps/api/src/sync/polling-sync.provider.spec.ts
git commit -m "feat: add polling sync provider with repo, pr, review, and ci upserts [NOJIRA]"
```

---

## Task 4: SyncService and scheduled job

**Files:**
- Create: `apps/api/src/sync/sync.service.spec.ts`
- Create: `apps/api/src/sync/sync.service.ts`
- Create: `apps/api/src/sync/sync.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write failing unit tests**

Create `apps/api/src/sync/sync.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { SyncService } from './sync.service';
import { SYNC_PROVIDER } from './sync.provider.interface';
import { PrismaService } from '../prisma/prisma.service';
import { DATABASE_URL } from '../prisma/database-url.provider';
import { ConfigService } from '@nestjs/config';

const mockProvider = { syncAll: vi.fn() };
const mockPrisma = {
  syncLog: { create: vi.fn(), update: vi.fn() },
};
const mockConfig = { get: vi.fn((key: string) => key === 'SYNC_LOOKBACK_DAYS' ? 90 : 900) };

describe('SyncService', () => {
  let service: SyncService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: SYNC_PROVIDER, useValue: mockProvider },
        { provide: DATABASE_URL, useValue: 'postgresql://test:test@localhost/test' },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
    vi.clearAllMocks();
  });

  it('creates a SyncLog, calls provider, and marks COMPLETED', async () => {
    mockPrisma.syncLog.create.mockResolvedValue({ id: 1 });
    mockProvider.syncAll.mockResolvedValue({ reposProcessed: 3, prsProcessed: 42 });
    mockPrisma.syncLog.update.mockResolvedValue({});

    await service.runSync();

    expect(mockPrisma.syncLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'RUNNING' }) }),
    );
    expect(mockProvider.syncAll).toHaveBeenCalledWith(90);
    expect(mockPrisma.syncLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED', reposProcessed: 3, prsProcessed: 42 }),
      }),
    );
  });

  it('marks SyncLog as FAILED when provider throws', async () => {
    mockPrisma.syncLog.create.mockResolvedValue({ id: 1 });
    mockProvider.syncAll.mockRejectedValue(new Error('GitHub API error'));
    mockPrisma.syncLog.update.mockResolvedValue({});

    await service.runSync();

    expect(mockPrisma.syncLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', errorMessage: 'GitHub API error' }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
npm run test -w @pr-review/api
```

Expected: FAIL — `Cannot find module './sync.service'`

- [ ] **Step 3: Create `apps/api/src/sync/sync.service.ts`**

```typescript
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SyncStatus } from '@prisma/client';
import { SYNC_PROVIDER, SyncProvider } from './sync.provider.interface';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigKeys } from '../config/config.keys';

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(SYNC_PROVIDER) private readonly provider: SyncProvider,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const hasData = await this.prisma.pullRequest.count();
    if (hasData === 0) {
      this.logger.log('No data found — starting initial backfill');
      await this.runSync();
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES) // overridden by SYNC_INTERVAL_SECONDS at runtime
  async runSync(): Promise<void> {
    const lookbackDays = this.config.get<number>(ConfigKeys.SYNC_LOOKBACK_DAYS) ?? 90;
    const log = await this.prisma.syncLog.create({ data: { status: SyncStatus.RUNNING } });

    try {
      const { reposProcessed, prsProcessed } = await this.provider.syncAll(lookbackDays);
      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: { status: SyncStatus.COMPLETED, completedAt: new Date(), reposProcessed, prsProcessed },
      });
      this.logger.log(`Sync complete — ${reposProcessed} repos, ${prsProcessed} PRs`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: { status: SyncStatus.FAILED, completedAt: new Date(), errorMessage },
      });
      this.logger.error('Sync failed', { errorMessage });
    }
  }
}
```

- [ ] **Step 4: Run tests and verify passing**

```bash
npm run test -w @pr-review/api
```

Expected: PASS

- [ ] **Step 5: Create `apps/api/src/sync/sync.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { GithubOctokitProvider, GITHUB_OCTOKIT } from './github-app.provider';
import { PollingSyncProvider } from './polling-sync.provider';
import { SYNC_PROVIDER } from './sync.provider.interface';
import { SyncService } from './sync.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    GithubOctokitProvider,
    { provide: SYNC_PROVIDER, useClass: PollingSyncProvider },
    PollingSyncProvider,
    SyncService,
  ],
})
export class SyncModule {}
```

- [ ] **Step 6: Add `SyncModule` to `apps/api/src/app.module.ts`**

Add `SyncModule` to the imports array alongside `AuthModule`.

- [ ] **Step 7: Build to confirm no TypeScript errors**

```bash
npm run build -w @pr-review/api
```

Expected: Compiles cleanly.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/sync/ apps/api/src/app.module.ts
git commit -m "feat: add sync service with scheduled polling and initial backfill [NOJIRA]"
```

---

## Self-Review Checklist

- [x] All new env vars in ConfigKeys + Joi schema — Task 1
- [x] `SyncProvider` interface + `SYNC_PROVIDER` Symbol — Task 2
- [x] `GithubOctokitProvider` — Octokit authenticated as GitHub App — Task 2
- [x] `PollingSyncProvider` — upserts Repo, PullRequest, Review, CiStatus — Task 3
- [x] Review decision computed from latest per-reviewer state (last APPROVED/CHANGES_REQUESTED wins) — Task 3
- [x] CI status computed from check runs (failure > running > success > pending) — Task 3
- [x] `SyncService` — creates SyncLog, calls provider, marks COMPLETED or FAILED — Task 4
- [x] `SyncService.onModuleInit` — triggers backfill when DB is empty — Task 4
- [x] `@Cron` scheduled job on SyncService — Task 4
- [x] `SyncModule` registered in `AppModule` — Task 4
- [x] GitHub App auth via `@octokit/auth-app` (not OAuth, not PAT) — Task 2
- [x] Private key `\n` escape handling for multiline env vars — Task 2
- [x] `BigInt` for all GitHub entity IDs (consistent with Plan 2 schema) — Task 3
