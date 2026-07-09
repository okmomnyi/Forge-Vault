import type { Metadata } from 'next';
import WhatsAppButton from '@/components/WhatsAppButton';
import { buildGeneralContactMessage } from '@/lib/whatsapp';
import { site } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Contact',
  description: `Reach ${site.name} in ${site.location} via WhatsApp, phone or email.`,
};

export default function ContactPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-3xl uppercase tracking-[0.12em] text-steel-white">
        Contact
      </h1>
      <p className="mt-2 text-muted-steel">
        The fastest way to order is WhatsApp — but call or email us any time.
      </p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div className="panel p-6">
          <div className="label-plate text-[10px]">WhatsApp</div>
          <p className="mt-2 text-sm text-muted-steel">
            Send a message and we&apos;ll help you find the right part.
          </p>
          <WhatsAppButton href={buildGeneralContactMessage()} className="mt-4 w-full">
            Chat on WhatsApp
          </WhatsAppButton>
        </div>

        <div className="panel p-6">
          <div className="label-plate text-[10px]">Phone &amp; Email</div>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <a
                href={`tel:${site.phoneTel}`}
                className="font-mono text-steel-white hover:text-diagram-cyan"
              >
                {site.phoneDisplay}
              </a>
            </li>
            <li>
              <a
                href={`mailto:${site.email}`}
                className="text-steel-white hover:text-diagram-cyan"
              >
                {site.email}
              </a>
            </li>
          </ul>
        </div>

        <div className="panel p-6 sm:col-span-2">
          <div className="label-plate text-[10px]">Visit the shop</div>
          <address className="mt-2 not-italic text-sm text-steel-white">
            {site.addressLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </address>
          <p className="mt-2 font-mono text-xs text-muted-steel">{site.hours}</p>
        </div>
      </div>
    </main>
  );
}
