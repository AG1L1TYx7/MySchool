import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:public';

/** Opt a route out of JWT authentication (login, register, health, callbacks). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
