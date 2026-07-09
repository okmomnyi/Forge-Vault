import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCategories, getPartById } from '@/lib/parts';
import PartForm from '@/components/admin/PartForm';

export const dynamic = 'force-dynamic';

export default async function EditPartPage({ params }: { params: { id: string } }) {
  const [categories, part] = await Promise.all([getCategories(), getPartById(params.id)]);
  if (!part) notFound();

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-diagram-cyan hover:underline">
          ← Back to catalog
        </Link>
        <h1 className="mt-2 font-display text-2xl uppercase tracking-[0.14em] text-steel-white">
          Edit Part
        </h1>
        <p className="font-mono text-xs text-muted-steel">/{part.slug}</p>
      </div>
      <PartForm categories={categories} initial={part} />
    </main>
  );
}
