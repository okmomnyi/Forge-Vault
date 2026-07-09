import Image from 'next/image';
import Link from 'next/link';
import { formatKes } from '@/lib/format';
import { conditionLabels, stockStatusLabels } from '@/design/tokens';
import type { PartListItem } from '@/lib/types';

/** Small crosshair registration tick, like a technical drawing's alignment mark. */
function RegMark({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={`pointer-events-none absolute h-3 w-3 text-diagram-cyan/70 ${className}`}
      aria-hidden="true"
    >
      <path d="M6 0v12M0 6h12" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

const stockPill: Record<string, string> = {
  in_stock: 'text-diagram-cyan',
  preorder: 'text-forge-orange',
  out_of_stock: 'text-muted-steel',
};

/**
 * Signature exploded-diagram product card (build spec §9): corner registration
 * marks, a leader line that draws itself in on hover connecting the spec block
 * to the image, and a faint blueprint grid behind the image on hover.
 */
export default function PartCard({ part }: { part: PartListItem }) {
  return (
    <Link
      href={`/parts/${part.slug}`}
      className="group relative block border border-diagram-cyan/40 bg-blueprint-navy p-3 transition-colors hover:border-diagram-cyan"
    >
      <RegMark className="left-1 top-1" />
      <RegMark className="right-1 top-1" />
      <RegMark className="bottom-1 left-1" />
      <RegMark className="bottom-1 right-1" />

      <div className="relative aspect-square w-full overflow-hidden bg-grid-line/20">
        {/* blueprint grid revealed on hover */}
        <div className="absolute inset-0 bg-blueprint-grid bg-grid opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        {part.primary_image ? (
          <Image
            src={part.primary_image}
            alt={part.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center font-mono text-xs text-muted-steel">
            no image
          </div>
        )}

        {/* leader line: draws in on hover, connecting image to the spec block */}
        <svg
          className="pointer-events-none absolute -bottom-3 right-4 h-6 w-16"
          viewBox="0 0 64 24"
          aria-hidden="true"
        >
          <polyline
            points="2,2 40,2 62,22"
            fill="none"
            stroke="#6FB7DE"
            strokeWidth="1"
            className="[stroke-dasharray:100] [stroke-dashoffset:100] transition-[stroke-dashoffset] duration-500 ease-out group-hover:[stroke-dashoffset:0]"
          />
        </svg>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="label-plate text-[10px]">{part.category_name ?? 'Part'}</span>
          <span className={`text-[10px] uppercase tracking-wide ${stockPill[part.stock_status]}`}>
            {stockStatusLabels[part.stock_status]}
          </span>
        </div>
        <h3 className="mt-1 line-clamp-2 font-body text-sm text-steel-white">{part.name}</h3>
        {part.part_number && (
          <p className="mt-0.5 font-mono text-[11px] text-muted-steel">{part.part_number}</p>
        )}
        <div className="mt-2 flex items-baseline justify-between">
          <span className="font-mono text-lg text-forge-orange">{formatKes(part.price_kes)}</span>
          <span className="font-mono text-[11px] text-muted-steel">
            {conditionLabels[part.condition]}
          </span>
        </div>
      </div>
    </Link>
  );
}
