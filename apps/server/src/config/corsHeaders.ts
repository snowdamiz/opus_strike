import { DEV_TUTORIAL_BYPASS_HEADER } from '@voxel-strike/shared';

export const ALLOWED_CORS_HEADERS = [
  'Authorization',
  'Content-Type',
  'X-CSRF-Token',
  'X-Internal-Status-Token',
  DEV_TUTORIAL_BYPASS_HEADER,
] as const;

export const ALLOWED_CORS_HEADER_VALUE = ALLOWED_CORS_HEADERS.join(', ');

export const ALLOWED_CORS_METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'DELETE',
  'OPTIONS',
] as const;

export const ALLOWED_CORS_METHOD_VALUE = ALLOWED_CORS_METHODS.join(', ');
