# PR Review Dashboard — Plan 3: Auth & Sessions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub OAuth login, server-side sessions backed by Redis, admin role seeding, and a session guard protecting all authenticated routes.

**Architecture:** GitHub OAuth App handles user login via Passport.js (`passport-github2`). After the callback, the backend upserts the `User` record in Postgres and stores the session in Redis via `express-session` + `connect-redis`. A `SessionGuard` NestJS guard protects all routes that require authentication. No access gate — any GitHub account can log in. Admin privileges are seeded at startup from the `ADMIN_GITHUB_USERS` env var.

**Tech Stack:** `passport`, `passport-github2`, `@nestjs/passport`, `express-session`, `connect-redis`, `ioredis`, `@nestjs/schedule` (for admin seed on init), Redis 7 (docker-compose)

---

## Design Decisions (from grill-me session)

- **Session strategy:** `express-session` + `connect-redis` (user chose this over JWT)
- **Access gate:** None — any GitHub account can log in
- **Admin role:** Seeded from `ADMIN_GITHUB_USERS` env var (comma-separated GitHub logins) on app startup; written to `User.isAdmin` in DB
- **Org membership check:** Not implemented (no gate chosen)
- **Cookie:** `httpOnly: true`, `secure: true` in production
- **Redis:** Added to `docker-compose.yml` alongside Postgres

---

## File Map

```
apps/api/
├── src/
│   ├── config/
│   │   └── config.keys.ts              # Modify — add SESSION_SECRET, GITHUB_*, REDIS_URL, ADMIN_GITHUB_USERS
│   │   └── config.ts                   # Modify — add Joi rules for new keys
│   ├── redis/
│   │   ├── redis.provider.ts           # Symbol + FactoryProvider for ioredis client
│   │   └── redis.module.ts             # Global module exporting redis client
│   ├── auth/
│   │   ├── auth.module.ts              # Imports PassportModule, GithubStrategy, SessionSerializer
│   │   ├── auth.controller.ts          # GET /auth/github, GET /auth/github/callback, POST /auth/logout, GET /auth/me
│   │   ├── auth.controller.spec.ts     # Unit tests
│   │   ├── github.strategy.ts          # PassportStrategy(Strategy, 'github') — validates and upserts user
│   │   ├── session.serializer.ts       # passport.serializeUser / deserializeUser
│   │   ├── session.guard.ts            # NestJS guard — checks req.isAuthenticated()
│   │   └── session.guard.spec.ts       # Unit tests
│   ├── users/
│   │   ├── users.module.ts             # Provides UsersService
│   │   ├── users.service.ts            # upsertFromGithub(), seedAdmins(), findById()
│   │   └── users.service.spec.ts       # Unit tests
│   └── app.module.ts                   # Modify — add RedisModule, AuthModule, UsersModule, session middleware, passport
└── main.ts                             # Modify — wire express-session + passport middleware
docker-compose.yml                      # Modify — add redis:7-alpine service
.env.example                            # Modify — add SESSION_SECRET, GITHUB_*, REDIS_URL, ADMIN_GITHUB_USERS
```

---

## Task 1: Add Redis to docker-compose and env

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `apps/api/src/config/config.keys.ts`
- Modify: `apps/api/src/config/config.ts`

- [ ] **Step 1: Add Redis service to `docker-compose.yml`**

Add after the `db` service:
```yaml
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
```

Add `redis_data:` under `volumes:`.

- [ ] **Step 2: Add env vars to `.env.example`**

Add below the DATABASE_URL line:
```
REDIS_URL=redis://localhost:6379

# Auth
SESSION_SECRET=change-me-to-a-random-secret-in-production
GITHUB_CLIENT_ID=your-github-oauth-app-client-id
GITHUB_CLIENT_SECRET=your-github-oauth-app-client-secret
GITHUB_CALLBACK_URL=http://localhost:3000/api/auth/github/callback

# Admin
ADMIN_GITHUB_USERS=your-github-username
```

- [ ] **Step 3: Update `apps/api/src/config/config.keys.ts`**

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
}
```

- [ ] **Step 4: Update `apps/api/src/config/config.ts`**

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
});
```

- [ ] **Step 5: Add REDIS_URL and new auth vars to local `.env`**

```bash
cat >> .env << 'EOF'
REDIS_URL=redis://localhost:6379
SESSION_SECRET=dev-secret-must-be-at-least-32-chars-long
GITHUB_CLIENT_ID=placeholder
GITHUB_CLIENT_SECRET=placeholder
GITHUB_CALLBACK_URL=http://localhost:3000/api/auth/github/callback
ADMIN_GITHUB_USERS=your-github-username
EOF
```

- [ ] **Step 6: Start Redis**

```bash
docker compose up -d redis
docker compose exec redis redis-cli ping
```

Expected: `PONG`

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml .env.example apps/api/src/config/
git commit -m "chore: add redis to docker-compose and auth env vars [NOJIRA]"
```

---

## Task 2: Redis module

**Files:**
- Create: `apps/api/src/redis/redis.provider.ts`
- Create: `apps/api/src/redis/redis.module.ts`

- [ ] **Step 1: Install dependencies**

```bash
npm install --save ioredis -w @pr-review/api
npm install --save-dev @types/ioredis -w @pr-review/api
```

- [ ] **Step 2: Write the failing unit test**

Create `apps/api/src/redis/redis.provider.spec.ts`:
```typescript
import { REDIS_CLIENT } from './redis.provider';

describe('REDIS_CLIENT token', () => {
  it('is a Symbol', () => {
    expect(typeof REDIS_CLIENT).toBe('symbol');
  });
});
```

- [ ] **Step 3: Run and verify it fails**

```bash
npm run test -w @pr-review/api
```

Expected: FAIL — `Cannot find module './redis.provider'`

- [ ] **Step 4: Create `apps/api/src/redis/redis.provider.ts`**

```typescript
import { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ConfigKeys } from '../config/config.keys';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export const RedisProvider: FactoryProvider<Redis> = {
  provide: REDIS_CLIENT,
  useFactory: (config: ConfigService) =>
    new Redis(config.get(ConfigKeys.REDIS_URL)!),
  inject: [ConfigService],
};
```

- [ ] **Step 5: Create `apps/api/src/redis/redis.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { RedisProvider } from './redis.provider';

@Global()
@Module({
  providers: [RedisProvider],
  exports: [RedisProvider],
})
export class RedisModule {}
```

- [ ] **Step 6: Run tests and verify passing**

```bash
npm run test -w @pr-review/api
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/redis/
git commit -m "feat: add global redis module [NOJIRA]"
```

---

## Task 3: UsersService

**Files:**
- Create: `apps/api/src/users/users.service.spec.ts`
- Create: `apps/api/src/users/users.service.ts`
- Create: `apps/api/src/users/users.module.ts`

- [ ] **Step 1: Install dependencies**

```bash
npm install --save passport passport-github2 @nestjs/passport express-session connect-redis -w @pr-review/api
npm install --save-dev @types/passport @types/passport-github2 @types/express-session @types/connect-redis -w @pr-review/api
```

- [ ] **Step 2: Write the failing unit test**

Create `apps/api/src/users/users.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { DATABASE_URL } from '../prisma/database-url.provider';

const mockPrisma = {
  user: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DATABASE_URL, useValue: 'postgresql://test:test@localhost/test' },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    vi.clearAllMocks();
  });

  describe('upsertFromGithub', () => {
    it('creates user if not exists', async () => {
      const profile = { id: '123', username: 'testuser', displayName: 'Test User', photos: [{ value: 'https://avatar.url' }] };
      mockPrisma.user.upsert.mockResolvedValue({ id: 1, githubId: 123n, login: 'testuser', isAdmin: false });

      const user = await service.upsertFromGithub(profile as any);

      expect(mockPrisma.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { githubId: 123n },
          create: expect.objectContaining({ githubId: 123n, login: 'testuser' }),
          update: expect.objectContaining({ login: 'testuser' }),
        }),
      );
      expect(user.login).toBe('testuser');
    });
  });

  describe('findById', () => {
    it('returns user by id', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 1, login: 'testuser' });
      const user = await service.findById(1);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(user?.login).toBe('testuser');
    });
  });

  describe('seedAdmins', () => {
    it('sets isAdmin true for configured logins', async () => {
      mockPrisma.user.update.mockResolvedValue({});
      await service.seedAdmins(['alice', 'bob']);
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
    });

    it('does nothing when logins list is empty', async () => {
      await service.seedAdmins([]);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: Run and verify it fails**

```bash
npm run test -w @pr-review/api
```

Expected: FAIL — `Cannot find module './users.service'`

- [ ] **Step 4: Create `apps/api/src/users/users.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { Profile } from 'passport-github2';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertFromGithub(profile: Profile): Promise<User> {
    const githubId = BigInt(profile.id);
    const avatarUrl = profile.photos?.[0]?.value ?? null;

    return this.prisma.user.upsert({
      where: { githubId },
      create: {
        githubId,
        login: profile.username!,
        name: profile.displayName ?? null,
        avatarUrl,
      },
      update: {
        login: profile.username!,
        name: profile.displayName ?? null,
        avatarUrl,
      },
    });
  }

  async findById(id: number): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async seedAdmins(logins: string[]): Promise<void> {
    await Promise.all(
      logins.map((login) =>
        this.prisma.user.update({ where: { login }, data: { isAdmin: true } }).catch(() => {
          // User hasn't logged in yet — skip
        }),
      ),
    );
  }
}
```

- [ ] **Step 5: Run and verify passing**

```bash
npm run test -w @pr-review/api
```

Expected: PASS

- [ ] **Step 6: Create `apps/api/src/users/users.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/users/
git commit -m "feat: add users service with github upsert and admin seeding [NOJIRA]"
```

---

## Task 4: Auth module (GitHub Strategy, SessionSerializer, SessionGuard)

**Files:**
- Create: `apps/api/src/auth/auth.controller.spec.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/github.strategy.ts`
- Create: `apps/api/src/auth/session.serializer.ts`
- Create: `apps/api/src/auth/session.guard.ts`
- Create: `apps/api/src/auth/session.guard.spec.ts`
- Create: `apps/api/src/auth/auth.module.ts`

- [ ] **Step 1: Write failing unit tests for SessionGuard**

Create `apps/api/src/auth/session.guard.spec.ts`:
```typescript
import { ExecutionContext } from '@nestjs/common';
import { vi } from 'vitest';
import { SessionGuard } from './session.guard';

function makeContext(isAuthenticated: boolean): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ isAuthenticated: () => isAuthenticated }),
    }),
  } as unknown as ExecutionContext;
}

describe('SessionGuard', () => {
  const guard = new SessionGuard();

  it('allows authenticated requests', () => {
    expect(guard.canActivate(makeContext(true))).toBe(true);
  });

  it('denies unauthenticated requests', () => {
    expect(guard.canActivate(makeContext(false))).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
npm run test -w @pr-review/api
```

Expected: FAIL — `Cannot find module './session.guard'`

- [ ] **Step 3: Create `apps/api/src/auth/session.guard.ts`**

```typescript
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class SessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    return request.isAuthenticated();
  }
}
```

- [ ] **Step 4: Create `apps/api/src/auth/github.strategy.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-github2';
import { ConfigKeys } from '../config/config.keys';
import { UsersService } from '../users/users.service';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(config: ConfigService, private readonly users: UsersService) {
    super({
      clientID: config.get(ConfigKeys.GITHUB_CLIENT_ID)!,
      clientSecret: config.get(ConfigKeys.GITHUB_CLIENT_SECRET)!,
      callbackURL: config.get(ConfigKeys.GITHUB_CALLBACK_URL)!,
      scope: ['read:user'],
    });
  }

  async validate(_accessToken: string, _refreshToken: string, profile: Profile) {
    return this.users.upsertFromGithub(profile);
  }
}
```

- [ ] **Step 5: Create `apps/api/src/auth/session.serializer.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { PassportSerializer } from '@nestjs/passport';
import { User } from '@prisma/client';
import { UsersService } from '../users/users.service';

@Injectable()
export class SessionSerializer extends PassportSerializer {
  constructor(private readonly users: UsersService) {
    super();
  }

  serializeUser(user: User, done: (err: unknown, id: number) => void): void {
    done(null, user.id);
  }

  async deserializeUser(id: number, done: (err: unknown, user: User | null) => void): Promise<void> {
    const user = await this.users.findById(id);
    done(null, user);
  }
}
```

- [ ] **Step 6: Write failing unit tests for AuthController**

Create `apps/api/src/auth/auth.controller.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { AuthController } from './auth.controller';
import { ConfigService } from '@nestjs/config';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: ConfigService, useValue: {} }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('githubCallback redirects to frontend', () => {
    const res = { redirect: vi.fn() };
    controller.githubCallback(res as any);
    expect(res.redirect).toHaveBeenCalledWith('/');
  });

  it('logout destroys session and redirects', () => {
    const req = { logout: vi.fn((cb: () => void) => cb()) };
    const res = { redirect: vi.fn() };
    controller.logout(req as any, res as any);
    expect(req.logout).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/');
  });

  it('me returns the current user', () => {
    const user = { id: 1, login: 'testuser' };
    const req = { user };
    expect(controller.me(req as any)).toEqual(user);
  });
});
```

- [ ] **Step 7: Run and verify it fails**

```bash
npm run test -w @pr-review/api
```

Expected: FAIL — `Cannot find module './auth.controller'`

- [ ] **Step 8: Create `apps/api/src/auth/auth.controller.ts`**

```typescript
import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { SessionGuard } from './session.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @Get('github')
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard('github'))
  githubLogin(): void {
    // Passport redirects to GitHub — this body never executes
  }

  @Get('github/callback')
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard('github'))
  githubCallback(@Res() res: Response): void {
    res.redirect('/');
  }

  @Post('logout')
  @ApiOkResponse({ description: 'Session destroyed' })
  logout(@Req() req: Request, @Res() res: Response): void {
    req.logout(() => res.redirect('/'));
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @ApiOkResponse({ description: 'Current authenticated user' })
  me(@Req() req: Request): unknown {
    return req.user;
  }
}
```

- [ ] **Step 9: Run and verify all tests pass**

```bash
npm run test -w @pr-review/api
```

Expected: PASS

- [ ] **Step 10: Create `apps/api/src/auth/auth.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { GithubStrategy } from './github.strategy';
import { SessionSerializer } from './session.serializer';
import { SessionGuard } from './session.guard';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PassportModule.register({ session: true }), UsersModule],
  controllers: [AuthController],
  providers: [GithubStrategy, SessionSerializer, SessionGuard],
  exports: [SessionGuard],
})
export class AuthModule {}
```

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/auth/
git commit -m "feat: add github oauth strategy, session guard, and auth controller [NOJIRA]"
```

---

## Task 5: Wire session middleware and admin seeding in AppModule / main.ts

**Files:**
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`
- Create: `apps/api/src/app.service.ts`

- [ ] **Step 1: Create `apps/api/src/app.service.ts`** (seeds admin users on startup)

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigKeys } from './config/config.keys';
import { UsersService } from './users/users.service';

@Injectable()
export class AppService implements OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  async onModuleInit(): Promise<void> {
    const raw = this.config.get(ConfigKeys.ADMIN_GITHUB_USERS) ?? '';
    const logins = raw.split(',').map((s: string) => s.trim()).filter(Boolean);
    await this.users.seedAdmins(logins);
  }
}
```

- [ ] **Step 2: Update `apps/api/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { validationSchema } from './config/config';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/api{/*path}'],
    }),
    PrismaModule,
    RedisModule,
    UsersModule,
    AuthModule,
    HealthModule,
  ],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 3: Update `apps/api/src/main.ts`** to wire session and passport middleware

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as session from 'express-session';
import * as passport from 'passport';
import { createClient } from 'ioredis';
import RedisStore from 'connect-redis';
import { AppModule } from './app.module';
import { ConfigKeys } from './config/config.keys';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: true }));

  const configService = app.get(ConfigService);

  const redisClient = new createClient(configService.get(ConfigKeys.REDIS_URL)!);

  app.use(
    session({
      store: new RedisStore({ client: redisClient }),
      secret: configService.get(ConfigKeys.SESSION_SECRET)!,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('PR Review Dashboard')
    .setDescription('API for the PR Review Dashboard')
    .setVersion('1.0')
    .addCookieAuth('connect.sid')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  app.enableShutdownHooks();

  const port = parseInt(configService.get(ConfigKeys.PORT, '3000'), 10);
  await app.listen(port);
}

bootstrap();
```

- [ ] **Step 4: Build to confirm no TypeScript errors**

```bash
npm run build -w @pr-review/api
```

Expected: Compiles cleanly.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.module.ts apps/api/src/app.service.ts apps/api/src/main.ts
git commit -m "feat: wire session middleware, passport, and admin seeding on startup [NOJIRA]"
```

---

## Task 6: E2E test for auth flow

**Files:**
- Create: `apps/api/test/auth.e2e-spec.ts`

- [ ] **Step 1: Create `apps/api/test/auth.e2e-spec.ts`**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as session from 'express-session';
import * as passport from 'passport';
import supertest from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: true }));
    app.use(session({ secret: 'test-secret-for-e2e-tests-only', resave: false, saveUninitialized: false }));
    app.use(passport.initialize());
    app.use(passport.session());

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/auth/me returns 403 when not authenticated', async () => {
    await supertest(app.getHttpServer())
      .get('/api/auth/me')
      .expect(403);
  });

  it('GET /api/auth/github redirects to GitHub', async () => {
    const res = await supertest(app.getHttpServer())
      .get('/api/auth/github')
      .expect(302);

    expect(res.headers.location).toContain('github.com');
  });
});
```

- [ ] **Step 2: Run e2e tests**

Ensure `DATABASE_URL` and `REDIS_URL` are in `.env` and both Postgres and Redis are running:

```bash
npm run test:e2e -w @pr-review/api
```

Expected: All e2e tests pass (health tests + auth tests).

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/auth.e2e-spec.ts
git commit -m "test: add auth e2e tests [NOJIRA]"
```

---

## Self-Review Checklist

- [x] Redis added to docker-compose — Task 1
- [x] All new env vars in ConfigKeys + Joi schema — Task 1
- [x] Redis global module with Symbol token + FactoryProvider — Task 2
- [x] `UsersService.upsertFromGithub` — creates or updates User from GitHub profile — Task 3
- [x] `UsersService.seedAdmins` — sets isAdmin from ADMIN_GITHUB_USERS — Task 3
- [x] `UsersService.findById` — for session deserialization — Task 3
- [x] `GithubStrategy` — Passport OAuth strategy — Task 4
- [x] `SessionSerializer` — serialize/deserialize user ID to/from session — Task 4
- [x] `SessionGuard` — NestJS guard checking `req.isAuthenticated()` — Task 4
- [x] `AuthController` — login initiation, callback redirect, logout, me — Task 4
- [x] Session middleware wired in `main.ts` — Task 5
- [x] Admin seeding on `AppModule` init via `AppService` — Task 5
- [x] E2E: unauthenticated /auth/me returns 403, /auth/github redirects to GitHub — Task 6
- [x] No access gate (any GitHub account can log in, per design decision) — Task 4
- [x] Cookie: httpOnly, secure in production — Task 5
