import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPartBySlug, getRelatedParts } from '@/lib/parts';
import PartGallery from '@/components/PartGallery';
import PartCard from '@/components/PartCard';
import WhatsAppButton from '@/components/WhatsAppButton';
import { buildOrderMessage, buildQueryMessage } from '@/lib/whatsapp';
import { formatKes, formatYearRange } from '@/lib/format';
import { conditionLabels, stockStatusLabels } from '@/design/tokens';
import { partUrl, site } from '@/lib/site';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const part = await getPartBySlug(params.slug);
  if (!part) return { title: 'Part not found' };

  const title = `${part.name}${part.category_name ? ` — ${part.category_name}` : ''}`;
  const description = `${part.name} · ${conditionLabels[part.condition]} · ${formatKes(
    part.price_kes,
  )}. ${site.name}, ${site.location}.`;
  const image = part.images[0]?.image_url;

  return {
    title,
    description,
    openGraph: {
      title: `${title} | ${site.name}`,
      description,
      url: partUrl(part.slug),
      type: 'website',
      images: image ? [{ url: image }] : undefined,
    },
  };
}

export default async function PartDetailPage({ params }: { params: { slug: string } }) {
  const part = await getPartBySlug(params.slug);
  if (!part) notFound();

  const related = await getRelatedParts(part.category_id, part.id, 4);
  const url = partUrl(part.slug);
  const price = Number(part.price_kes);
  const outOfStock = part.stock_status === 'out_of_stock';

  const orderHref = buildOrderMessage({
    name: part.name,
    partNumber: part.part_number,
    priceKes: price,
    url,
  });
  const queryHref = buildQueryMessage({ name: part.name, url });

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Link href="/parts" className="text-sm text-diagram-cyan hover:underline">
        ← Back to catalog
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <PartGallery images={part.images} alt={part.name} />

        <div>
          {part.category_name && (
            <Link
              href={`/parts?category=${part.category_slug}`}
              className="label-plate text-xs hover:text-diagram-cyan"
            >
              {part.category_name}
            </Link>
          )}
          <h1 className="mt-1 font-display text-3xl uppercase tracking-[0.08em] text-steel-white">
            {part.name}
          </h1>

          <div className="mt-4 flex items-center gap-4">
            <span className="font-mono text-3xl text-forge-orange">{formatKes(part.price_kes)}</span>
            <span
              className={`border px-2 py-1 text-xs uppercase tracking-wide ${
                outOfStock
                  ? 'border-muted-steel/60 text-muted-steel'
                  : part.stock_status === 'preorder'
                    ? 'border-forge-orange/60 text-forge-orange'
                    : 'border-diagram-cyan/60 text-diagram-cyan'
              }`}
            >
              {stockStatusLabels[part.stock_status]}
            </span>
          </div>

          {outOfStock && (
            <p className="mt-3 border border-muted-steel/40 bg-grid-line/30 px-3 py-2 text-sm text-muted-steel">
              This part is currently out of stock. Message us to check restock timing or find an
              alternative.
            </p>
          )}

          {/* spec block */}
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-diagram-cyan/30 py-5 text-sm">
            <div>
              <dt className="label-plate text-[10px]">Part Number</dt>
              <dd className="font-mono text-steel-white">{part.part_number ?? '—'}</dd>
            </div>
            <div>
              <dt className="label-plate text-[10px]">Condition</dt>
              <dd className="text-steel-white">{conditionLabels[part.condition]}</dd>
            </div>
            <div>
              <dt className="label-plate text-[10px]">Category</dt>
              <dd className="text-steel-white">{part.category_name ?? '—'}</dd>
            </div>
          </dl>

          {part.compatibility.length > 0 && (
            <div className="mt-5">
              <div className="label-plate text-[10px]">Fits</div>
              <ul className="mt-2 space-y-1 text-sm text-steel-white">
                {part.compatibility.map((c, i) => {
                  const years = formatYearRange(c.year_start, c.year_end);
                  return (
                    <li key={c.id ?? i} className="font-mono">
                      {c.make} {c.model}
                      {years ? ` · ${years}` : ''}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {part.description && (
            <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-steel-white">
              {part.description}
            </p>
          )}

          {/* the "checkout": two distinct WhatsApp intents */}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <WhatsAppButton href={orderHref} variant="solid" className="flex-1">
              Order This Part
            </WhatsAppButton>
            <WhatsAppButton href={queryHref} variant="outline" className="flex-1">
              Ask a Question
            </WhatsAppButton>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="font-display text-xl uppercase tracking-[0.12em] text-steel-white">
            Related Parts
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            {related.map((r) => (
              <PartCard key={r.id} part={r} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
