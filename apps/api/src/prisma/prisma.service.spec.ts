import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(() => {
    service = new PrismaService('postgresql://test:test@localhost:5432/test');
  });

  it('extends PrismaClient', () => {
    // Prisma 7 with driver adapters returns a Proxy from the constructor,
    // so instanceof is unreliable at runtime. Check the prototype chain
    // statically to confirm the class declaration `extends PrismaClient`.
    expect(Object.getPrototypeOf(PrismaService.prototype)).toBe(PrismaClient.prototype);
  });

  it('implements onModuleInit', () => {
    expect(typeof service.onModuleInit).toBe('function');
  });

  it('implements onModuleDestroy', () => {
    expect(typeof service.onModuleDestroy).toBe('function');
  });
});
