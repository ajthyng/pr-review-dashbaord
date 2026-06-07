import * as Joi from 'joi';
import { ConfigKeys } from './config.keys';

export const validationSchema = Joi.object({
  [ConfigKeys.PORT]: Joi.number().default(3000),
  [ConfigKeys.DATABASE_URL]: Joi.string().required(),
});
