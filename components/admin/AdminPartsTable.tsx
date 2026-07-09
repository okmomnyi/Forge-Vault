'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatKes } from '@/lib/format';
import { stockStatusLabels } from '@/design/tokens';
import { STOCK_STATUSES, type PartListItem, type StockStatus } from '@/lib/types';

/** Cycle order for the one-click stock toggle. */
function nextStatus(current: StockStatus): StockStatus {
  const i = STOCK_STATUSES.indexOf(current);
  return STOCK_STATUSES[(i + 1) % STOCK_STATUSES.length];
}

const statusPill: Record<StockStatus, string> = {
  in_stock: 'border-diagram-cyan/60 text-diagram-cyan',
  preorder: 'border-forge-orange/60 text-forge-orange',
  out_of_stock: 'border-muted-steel/60 text-muted-steel',
};

interface DeletedImages {
  name: string;
  urls: string[];
}

export default function AdminPartsTable({ parts }: { parts: PartListItem[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(parts);
  const [busy, setBusy] = useState<string | null>(null);
  const [imgbbCleanup, setImgbbCleanup] = useState<DeletedImages[]>([]);

  async function toggleStatus(part: PartListItem) {
    const target = nextStatus(part.stock_status);
    setBusy(part.id);
    // optimistic
    setRows((r) => r.map((p) => (p.id === part.id ? { ...p, stock_status: target } : p)));
    try {
      const res = await fetch(`/api/admin/parts/${part.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_status: target }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // revert on failure
      setRows((r) => r.map((p) => (p.id === part.id ? { ...p, stock_status: part.stock_status } : p)));
    } finally {
      setBusy(null);
    }
  }

  async function remove(part: PartListItem) {
    if (!confirm(`Delete "${part.name}"? This cannot be undone.`)) return;
    setBusy(part.id);
    try {
      const res = await fetch(`/api/admin/parts/${part.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      const data = await res.json().catch(() => ({}));
      const urls: string[] = Array.isArray(data.deleteUrls) ? data.deleteUrls : [];
      setRows((r) => r.filter((p) => p.id !== part.id));
      if (urls.length > 0) {
        setImgbbCleanup((c) => [...c, { name: part.name, urls }]);
      }
      router.refresh();
    } catch {
      alert('Delete failed.');
    } finally {
      setBusy(null);
    }
  }

  const cleanupPanel =
    imgbbCleanup.length > 0 ? (
      <div className="mb-6 border border-forge-orange/50 bg-forge-orange/10 p-4">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-steel-white">
            These images are still on imgbb (no delete API). Open each link to remove them:
          </p>
          <button
            type="button"
            onClick={() => setImgbbCleanup([])}
            className="text-xs uppercase tracking-wide text-muted-steel hover:text-steel-white"
          >
            Dismiss
          </button>
        </div>
        <ul className="mt-3 space-y-2">
          {imgbbCleanup.map((entry, i) => (
            <li key={i} className="text-sm">
              <span className="text-muted-steel">{entry.name}:</span>{' '}
              <span className="inline-flex flex-wrap gap-3">
                {entry.urls.map((url, j) => (
                  <a
                    key={j}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-diagram-cyan hover:text-forge-orange"
                  >
                    delete image {j + 1} ↗
                  </a>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  if (rows.length === 0) {
    return (
      <div>
        {cleanupPanel}
        <p className="panel p-6 text-muted-steel">
          No parts yet. Add your first part to get started.
        </p>
      </div>
    );
  }

  return (
    <div>
      {cleanupPanel}
      <div className="panel overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-diagram-cyan/40 text-xs uppercase tracking-wider text-muted-steel">
            <th className="px-4 py-3 font-display">Name</th>
            <th className="px-4 py-3 font-display">Category</th>
            <th className="px-4 py-3 font-display">Price</th>
            <th className="px-4 py-3 font-display">Stock</th>
            <th className="px-4 py-3 font-display">Updated</th>
            <th className="px-4 py-3 font-display">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((part) => (
            <tr key={part.id} className="border-b border-grid-line/70 last:border-0">
              <td className="px-4 py-3">
                <span className="text-steel-white">{part.name}</span>
                {!part.is_active && (
                  <span className="ml-2 text-xs uppercase text-muted-steel">(hidden)</span>
                )}
                {part.part_number && (
                  <div className="font-mono text-xs text-muted-steel">{part.part_number}</div>
                )}
              </td>
              <td className="px-4 py-3 text-muted-steel">{part.category_name ?? '—'}</td>
              <td className="px-4 py-3 font-mono text-forge-orange">{formatKes(part.price_kes)}</td>
              <td className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => toggleStatus(part)}
                  disabled={busy === part.id}
                  title="Click to change stock status"
                  className={`border px-2 py-1 text-xs uppercase tracking-wide transition-opacity hover:opacity-80 disabled:opacity-50 ${statusPill[part.stock_status]}`}
                >
                  {stockStatusLabels[part.stock_status]}
                </button>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-steel">
                {new Date(part.updated_at).toLocaleDateString('en-KE')}
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-3">
                  <Link
                    href={`/admin/parts/${part.id}/edit`}
                    className="text-diagram-cyan hover:underline"
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(part)}
                    disabled={busy === part.id}
                    className="text-forge-orange hover:underline disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
