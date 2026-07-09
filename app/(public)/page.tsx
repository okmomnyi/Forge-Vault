import Link from 'next/link';
import { getCategories, getRecentParts } from '@/lib/parts';
import PartCard from '@/components/PartCard';
import WhatsAppButton from '@/components/WhatsAppButton';
import { buildGeneralContactMessage } from '@/lib/whatsapp';
import { site } from '@/lib/site';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [recent, categories] = await Promise.all([getRecentParts(8), getCategories()]);

  return (
    <main>
      {/* Hero — blueprint / exploded-diagram framing */}
      <section className="relative overflow-hidden border-b border-diagram-cyan/40">
        <div className="absolute inset-0 bg-blueprint-grid bg-grid opacity-40" aria-hidden="true" />
        {/* faux dimension lines */}
        <div className="pointer-events-none absolute left-0 top-10 hidden h-px w-40 bg-diagram-cyan/40 lg:block" />
        <div className="pointer-events-none absolute bottom-10 right-0 hidden h-px w-56 bg-diagram-cyan/40 lg:block" />

        <div className="relative mx-auto max-w-6xl px-6 py-20">
          <div className="label-plate text-xs">{site.name} · {site.location}</div>
          <h1 className="mt-3 max-w-3xl font-display text-4xl uppercase leading-tight tracking-[0.06em] text-steel-white sm:text-6xl">
            The right part,
            <span className="text-forge-orange"> engineered to fit.</span>
          </h1>
          <p className="mt-4 max-w-xl text-muted-steel">{site.tagline}</p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/parts"
              className="bg-forge-orange px-6 py-3 font-display uppercase tracking-[0.12em] text-blueprint-navy transition-opacity hover:opacity-90"
            >
              Browse Catalog
            </Link>
            <WhatsAppButton href={buildGeneralContactMessage()} variant="outline">
              Chat on WhatsApp
            </WhatsAppButton>
          </div>
        </div>
      </section>

      {/* Category quick-links */}
      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/parts?category=${c.slug}`}
              className="border border-diagram-cyan/40 px-4 py-2 text-sm uppercase tracking-wide text-steel-white transition-colors hover:border-diagram-cyan hover:text-diagram-cyan"
            >
              {c.name}
            </Link>
          ))}
        </div>
      </section>

      {/* Recently Added — proves fresh daily stock */}
      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl uppercase tracking-[0.12em] text-steel-white">
            Recently Added
          </h2>
          <Link href="/parts" className="text-sm text-diagram-cyan hover:underline">
            View all →
          </Link>
        </div>

        {recent.length === 0 ? (
          <p className="panel mt-6 p-8 text-center text-muted-steel">
            No parts listed yet — check back soon.
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {recent.map((part) => (
              <PartCard key={part.id} part={part} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
