import { describe, expect, it } from 'vitest';
import { isOfflineError } from './client.js';

describe('isOfflineError', () => {
  it('classifies connectivity failures as offline', () => {
    const cases = [
      { code: 'ENOTFOUND' },
      { code: 'ECONNREFUSED' },
      { code: 'ECONNRESET' },
      { code: 'ETIMEDOUT' },
      { code: 'EAI_AGAIN' },
      { code: 'ECONNABORTED' }, // request timeout (gaxios)
      { errno: 'ENETUNREACH' },
      { cause: { code: 'ENOTFOUND' } }, // wrapped (undici/fetch style)
      new Error('getaddrinfo ENOTFOUND oauth2.googleapis.com'),
      new Error('request to https://www.googleapis.com failed, reason: connect ETIMEDOUT'),
      new Error('socket hang up'),
      new Error('timeout of 15000ms exceeded'),
    ];
    for (const c of cases) expect(isOfflineError(c), JSON.stringify(c)).toBe(true);
  });

  it('does NOT treat real API rejections as offline', () => {
    const cases = [
      { code: 401, message: 'Invalid Credentials' },
      { code: 403, message: 'Rate Limit Exceeded' },
      { code: 404, message: 'Not Found' },
      { response: { status: 410 }, message: 'Sync token is no longer valid' },
      new Error('Invalid grant'),
      new Error('Calendar usage limits exceeded'),
    ];
    for (const c of cases) expect(isOfflineError(c), JSON.stringify(c)).toBe(false);
  });
});
