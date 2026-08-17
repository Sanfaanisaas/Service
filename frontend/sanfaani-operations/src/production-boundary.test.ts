import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const openApi = readFileSync(new URL('../../../lib/api-spec/openapi.yaml', import.meta.url), 'utf8');

describe('production product boundary', () => {
  it('does not expose public signup or customer portal routes', () => {
    expect(appSource).not.toContain('path="/sign-up');
    expect(appSource).not.toContain('path="/customer');
    expect(appSource).not.toContain('supabase.auth.signUp');
    expect(appSource).toContain('path="/access-restricted"');
    expect(appSource).toContain('import.meta.env.DEV && <Route path="/preview');
  });

  it('preserves dormant customer ownership APIs in the canonical contract', () => {
    for (const path of [
      '/customer/me:',
      '/customer/me/charging:',
      '/customer/me/receipts:',
      '/customer/me/workspace:',
      '/customer/me/notifications:',
    ]) expect(openApi).toContain(path);
  });
});
