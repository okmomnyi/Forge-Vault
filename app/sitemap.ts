import type { MetadataRoute } from 'next';
import { getActivePartSlugs } from '@/lib/parts';
import { siteUrl } from '@/lib/site';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const parts = await getActivePartSlugs();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/parts`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/contact`, changeFrequency: 'monthly', priority: 0.3 },
  ];

  const partRoutes: MetadataRoute.Sitemap = parts.map((p) => ({
    url: `${base}/parts/${p.slug}`,
    lastModified: new Date(p.updated_at),
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  return [...staticRoutes, ...partRoutes];
}
