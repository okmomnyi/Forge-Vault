import type { Metadata } from 'next';
import { getCategories, getCompatibilityFacets, listActiveParts } from '@/lib/parts';
import FilterBar from '@/components/FilterBar';
import PartCard from '@/components/PartCard';
import { site } from '@/lib/site';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Catalog',
  description: `Browse new, used and refurbished car spare parts at ${site.name}, ${site.location}.`,
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: { category?: string | string[]; make?: string | string[]; model?: string | string[]; search?: string | string[] };
}) {
  const filters = {
    categorySlug: first(searchParams.category),
    make: first(searchParams.make),
    model: first(searchParams.model),
    search: first(searchParams.search),
  };

  const [categories, facets, parts] = await Promise.all([
    getCategories(),
    getCompatibilityFacets(),
    listActiveParts(filters),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="font-display text-3xl uppercase tracking-[0.12em] text-steel-white">Catalog</h1>
      <p className="mt-1 text-sm text-muted-steel">{parts.length} part(s) available</p>

      <div className="mt-6">
        <FilterBar categories={categories} makes={facets.makes} models={facets.models} />
      </div>

      {parts.length === 0 ? (
        <p className="panel mt-8 p-8 text-center text-muted-steel">
          No parts match your filters. Try clearing them.
        </p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {parts.map((part) => (
            <PartCard key={part.id} part={part} />
          ))}
        </div>
      )}
    </main>
  );
}
