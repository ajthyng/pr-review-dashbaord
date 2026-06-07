import { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigKeys } from '../config/config.keys';

export const DATABASE_URL = Symbol('DATABASE_URL');

export const DatabaseUrlProvider: FactoryProvider<string> = {
  provide: DATABASE_URL,
  useFactory: (config: ConfigService) => config.get(ConfigKeys.DATABASE_URL)!,
  inject: [ConfigService],
};
