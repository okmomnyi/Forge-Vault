import Link from 'next/link';
import WhatsAppButton from '@/components/WhatsAppButton';
import { buildGeneralContactMessage } from '@/lib/whatsapp';
import { site } from '@/lib/site';

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-diagram-cyan/40 bg-blueprint-navy/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-xl uppercase tracking-[0.16em] text-steel-white">
            Forge
          </span>
          <span className="font-display text-xl uppercase tracking-[0.16em] text-forge-orange">
            Auto Parts
          </span>
        </Link>

        <nav className="hidden items-center gap-6 sm:flex">
          <Link href="/parts" className="text-sm uppercase tracking-wide text-steel-white hover:text-diagram-cyan">
            Catalog
          </Link>
          <Link href="/contact" className="text-sm uppercase tracking-wide text-steel-white hover:text-diagram-cyan">
            Contact
          </Link>
        </nav>

        <WhatsAppButton href={buildGeneralContactMessage()} className="px-3 py-2 text-xs">
          <span className="hidden sm:inline">Chat on WhatsApp</span>
          <span className="sm:hidden">WhatsApp</span>
        </WhatsAppButton>
      </div>

      {/* mobile nav row */}
      <nav className="flex items-center gap-6 border-t border-grid-line/60 px-6 py-2 sm:hidden">
        <Link href="/parts" className="text-xs uppercase tracking-wide text-steel-white">
          Catalog
        </Link>
        <Link href="/contact" className="text-xs uppercase tracking-wide text-steel-white">
          Contact
        </Link>
        <span className="ml-auto font-mono text-xs text-muted-steel">{site.location}</span>
      </nav>
    </header>
  );
}
