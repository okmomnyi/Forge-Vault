import Link from 'next/link';
import { buildGeneralContactMessage } from '@/lib/whatsapp';
import { site } from '@/lib/site';

export default function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-diagram-cyan/40 bg-blueprint-navy">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10 sm:grid-cols-3">
        <div>
          <div className="font-display text-lg uppercase tracking-[0.16em] text-steel-white">
            {site.name}
          </div>
          <p className="mt-2 text-sm text-muted-steel">{site.tagline}</p>
        </div>

        <div>
          <div className="label-plate text-[10px]">Visit</div>
          <address className="mt-2 not-italic text-sm text-steel-white">
            {site.addressLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
            <div className="mt-1 font-mono text-xs text-muted-steel">{site.hours}</div>
          </address>
        </div>

        <div>
          <div className="label-plate text-[10px]">Get in touch</div>
          <ul className="mt-2 space-y-1 text-sm">
            <li>
              <a
                href={buildGeneralContactMessage()}
                target="_blank"
                rel="noopener noreferrer"
                className="text-whatsapp-green hover:underline"
              >
                WhatsApp us
              </a>
            </li>
            <li>
              <a href={`tel:${site.phoneTel}`} className="font-mono text-steel-white hover:text-diagram-cyan">
                {site.phoneDisplay}
              </a>
            </li>
            <li>
              <a href={`mailto:${site.email}`} className="text-steel-white hover:text-diagram-cyan">
                {site.email}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-grid-line/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 text-xs text-muted-steel">
          <span className="font-mono">© {site.name}</span>
          <Link href="/admin" className="hover:text-diagram-cyan">
            Admin
          </Link>
        </div>
      </div>
    </footer>
  );
}
