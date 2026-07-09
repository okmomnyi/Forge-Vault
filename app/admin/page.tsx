import Link from 'next/link';
import { listPartsForAdmin } from '@/lib/parts';
import { getSession } from '@/lib/session';
import AdminPartsTable from '@/components/admin/AdminPartsTable';

// Always render fresh — the admin needs to see current stock immediately.
export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const [session, parts] = await Promise.all([getSession(), listPartsForAdmin()]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-diagram-cyan/40 pb-4">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-[0.14em] text-steel-white">
            Catalog Admin
          </h1>
          {session && <p className="text-xs text-muted-steel">{session.email}</p>}
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/parts/new"
            className="bg-forge-orange px-5 py-2 font-display uppercase tracking-[0.12em] text-blueprint-navy transition-opacity hover:opacity-90"
          >
            + Add New Part
          </Link>
          <form action="/api/admin/logout" method="post">
            <button
              type="submit"
              className="border border-diagram-cyan/50 px-4 py-2 font-display text-sm uppercase tracking-[0.12em] text-diagram-cyan hover:bg-diagram-cyan/10"
            >
              Log out
            </button>
          </form>
        </div>
      </header>

      <AdminPartsTable parts={parts} />
    </main>
  );
}
