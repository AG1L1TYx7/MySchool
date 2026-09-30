import { VERSION_NEUTRAL } from '@nestjs/common';

/**
 * Route preservation (ADR-010): the previous API served most controllers at both
 * `/api/<Name>` and `/api/v1/<Name>`. Use `V1_AND_NEUTRAL` for those controllers,
 * `V1_ONLY` for routes that only existed under /api/v1, and `V2_ONLY` for v2 controllers.
 */
export const V1_AND_NEUTRAL = ['1', VERSION_NEUTRAL] as const;
export const V1_ONLY = '1';
export const V2_ONLY = '2';
export const NEUTRAL = VERSION_NEUTRAL;
