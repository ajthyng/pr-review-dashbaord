import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PrismaService (e2e)', () => {
  let prismaService: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }),
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
