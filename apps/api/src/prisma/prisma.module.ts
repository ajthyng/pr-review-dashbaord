import { Global, Module } from '@nestjs/common';
import { DatabaseUrlProvider } from './database-url.provider';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [DatabaseUrlProvider, PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
