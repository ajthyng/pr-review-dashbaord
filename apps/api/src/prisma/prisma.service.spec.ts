import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { vi } from 'vitest';
import { DATABASE_URL } from './database-url.provider';
import { PrismaService } from './prisma.service';

const TEST_DB_URL = 'postgresql://test:test@localhost:5432/test';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(() => {
    service = new PrismaService(TEST_DB_URL);
  });

  it('extends PrismaClient', () => {
    expect(Object.getPrototypeOf(PrismaService.prototype)).toBe(PrismaClient.prototype);
  });

  it('calls $connect on module init', async () => {
    const spy = vi.spyOn(service, '$connect').mockResolvedValue(undefined);
    await service.onModuleInit();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('calls $disconnect on module destroy', async () => {
    const spy = vi.spyOn(service, '$disconnect').mockResolvedValue(undefined);
    await service.onModuleDestroy();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('resolves via NestJS DI when DATABASE_URL token is provided', async () => {
    const module = await Test.createTestingModule({
      providers: [
        { provide: DATABASE_URL, useValue: TEST_DB_URL },
        PrismaService,
      ],
    }).compile();

    const resolved = module.get(PrismaService);
    expect(resolved).toBeDefined();
    vi.spyOn(resolved, '$disconnect').mockResolvedValue(undefined);
    await module.close();
  });
});
