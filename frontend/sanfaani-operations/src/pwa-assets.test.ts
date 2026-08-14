import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const publicAsset = (name: string) => new URL(`../public/${name}`, import.meta.url);

describe('PWA assets', () => {
  it('defines a standalone manifest with standard and maskable icons', async () => {
    const manifest = JSON.parse(await readFile(publicAsset('manifest.webmanifest'), 'utf8'));
    expect(manifest).toMatchObject({ name: 'SANFAANI Operations', display: 'standalone', start_url: '/', theme_color: '#10151a' });
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192' }), expect.objectContaining({ sizes: '512x512' }),
      expect.objectContaining({ purpose: 'maskable' }),
    ]));
  });

  it('never caches authenticated API responses and handles push clicks', async () => {
    const worker = await readFile(publicAsset('sw.js'), 'utf8');
    expect(worker).toContain("url.pathname.startsWith('/api/')");
    expect(worker).toContain("addEventListener('push'");
    expect(worker).toContain("addEventListener('notificationclick'");
  });
});
