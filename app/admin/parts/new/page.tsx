import Link from 'next/link';
import { getCategories } from '@/lib/parts';
import PartForm from '@/components/admin/PartForm';

export const dynamic = 'force-dynamic';

export default async function NewPartPage() {
  const categories = await getCategories();

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-diagram-cyan hover:underline">
          ← Back to catalog
        </Link>
        <h1 className="mt-2 font-display text-2xl uppercase tracking-[0.14em] text-steel-white">
          Add New Part
        </h1>
      </div>
      <PartForm categories={categories} />
    </main>
  );
}
