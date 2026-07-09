'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ImageUploader from '@/components/admin/ImageUploader';
import {
  CONDITIONS,
  STOCK_STATUSES,
  type Category,
  type Compatibility,
  type PartDetail,
  type UploadedImage,
} from '@/lib/types';
import { conditionLabels, stockStatusLabels } from '@/design/tokens';

interface PartFormProps {
  categories: Category[];
  initial?: PartDetail;
}

interface CompatRow extends Compatibility {
  key: string;
}

let rowSeq = 0;
function newRow(): CompatRow {
  rowSeq += 1;
  return { key: `r${rowSeq}`, make: '', model: '', year_start: null, year_end: null };
}

const inputClass =
  'w-full border border-diagram-cyan/40 bg-grid-line/30 px-3 py-2 text-steel-white outline-none focus:border-diagram-cyan';
const labelClass = 'label-plate text-xs';

export default function PartForm({ categories, initial }: PartFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initial);

  const [name, setName] = useState(initial?.name ?? '');
  const [partNumber, setPartNumber] = useState(initial?.part_number ?? '');
  const [categoryId, setCategoryId] = useState<string>(
    initial?.category_id != null ? String(initial.category_id) : '',
  );
  const [price, setPrice] = useState<string>(initial ? String(Number(initial.price_kes)) : '');
  const [condition, setCondition] = useState(initial?.condition ?? 'used');
  const [stockStatus, setStockStatus] = useState(initial?.stock_status ?? 'in_stock');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [images, setImages] = useState<UploadedImage[]>(
    initial?.images.map((i) => ({ url: i.image_url, delete_url: i.delete_url })) ?? [],
  );

  // Images that existed when the form loaded but have since been removed. imgbb
  // can't be deleted via API, so we surface their delete links for manual cleanup.
  const removedImages = (initial?.images ?? []).filter(
    (orig) => orig.delete_url && !images.some((cur) => cur.url === orig.image_url),
  );
  const [compat, setCompat] = useState<CompatRow[]>(
    initial?.compatibility.length
      ? initial.compatibility.map((c) => ({ ...newRow(), ...c }))
      : [newRow()],
  );

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function updateCompat(key: string, patch: Partial<Compatibility>) {
    setCompat((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) return setError('Name is required.');
    if (!categoryId) return setError('Category is required.');
    if (!price || Number(price) < 0) return setError('A valid price is required.');
    if (images.length === 0) return setError('At least one image is required.');

    setSaving(true);
    const payload = {
      name: name.trim(),
      part_number: partNumber.trim() || null,
      category_id: Number(categoryId),
      description: description.trim() || null,
      price_kes: Number(price),
      condition,
      stock_status: stockStatus,
      is_active: isActive,
      images,
      compatibility: compat
        .filter((c) => c.make.trim() && c.model.trim())
        .map(({ make, model, year_start, year_end }) => ({ make, model, year_start, year_end })),
    };

    try {
      const res = await fetch(isEdit ? `/api/admin/parts/${initial!.id}` : '/api/admin/parts', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Save failed.');
        setSaving(false);
        return;
      }
      router.push('/admin');
      router.refresh();
    } catch {
      setError('Network error. Try again.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="name">
            Name <span className="text-forge-orange">*</span>
          </label>
          <input id="name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </div>

        <div>
          <label className={labelClass} htmlFor="category">
            Category <span className="text-forge-orange">*</span>
          </label>
          <select
            id="category"
            className={inputClass}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
          >
            <option value="">Select…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="price">
            Price (KES) <span className="text-forge-orange">*</span>
          </label>
          <input
            id="price"
            type="number"
            min="0"
            step="1"
            className={`${inputClass} font-mono`}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="partNumber">
            Part Number
          </label>
          <input
            id="partNumber"
            className={`${inputClass} font-mono`}
            value={partNumber}
            onChange={(e) => setPartNumber(e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="condition">
            Condition
          </label>
          <select
            id="condition"
            className={inputClass}
            value={condition}
            onChange={(e) => setCondition(e.target.value as typeof condition)}
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {conditionLabels[c]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="stock">
            Stock Status
          </label>
          <select
            id="stock"
            className={inputClass}
            value={stockStatus}
            onChange={(e) => setStockStatus(e.target.value as typeof stockStatus)}
          >
            {STOCK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {stockStatusLabels[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-steel-white">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 accent-forge-orange"
            />
            Active (visible on the site)
          </label>
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="description">
            Description
          </label>
          <textarea
            id="description"
            rows={4}
            className={inputClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      <div>
        <span className={labelClass}>
          Images <span className="text-forge-orange">*</span>
        </span>
        <p className="mb-2 text-xs text-muted-steel">First image is the primary/preview image.</p>
        <ImageUploader value={images} onChange={setImages} />

        {removedImages.length > 0 && (
          <div className="mt-3 border border-muted-steel/40 bg-grid-line/20 p-3">
            <p className="text-xs text-muted-steel">
              Removed images stay on imgbb until you delete them there. Open each link to remove it:
            </p>
            <ul className="mt-2 flex flex-wrap gap-3">
              {removedImages.map((img) => (
                <li key={img.id}>
                  <a
                    href={img.delete_url ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-diagram-cyan hover:text-forge-orange"
                  >
                    delete on imgbb ↗
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className={labelClass}>Compatible Vehicles</span>
          <button
            type="button"
            onClick={() => setCompat((r) => [...r, newRow()])}
            className="border border-diagram-cyan/50 px-2 py-1 text-xs uppercase tracking-wide text-diagram-cyan hover:bg-diagram-cyan/10"
          >
            + Add row
          </button>
        </div>
        <div className="space-y-2">
          {compat.map((row) => (
            <div key={row.key} className="grid grid-cols-2 gap-2 sm:grid-cols-9">
              <input
                placeholder="Make"
                className={`${inputClass} sm:col-span-3`}
                value={row.make}
                onChange={(e) => updateCompat(row.key, { make: e.target.value })}
              />
              <input
                placeholder="Model"
                className={`${inputClass} sm:col-span-3`}
                value={row.model}
                onChange={(e) => updateCompat(row.key, { model: e.target.value })}
              />
              <input
                placeholder="From"
                type="number"
                className={`${inputClass} font-mono sm:col-span-1`}
                value={row.year_start ?? ''}
                onChange={(e) =>
                  updateCompat(row.key, { year_start: e.target.value ? Number(e.target.value) : null })
                }
              />
              <input
                placeholder="To"
                type="number"
                className={`${inputClass} font-mono sm:col-span-1`}
                value={row.year_end ?? ''}
                onChange={(e) =>
                  updateCompat(row.key, { year_end: e.target.value ? Number(e.target.value) : null })
                }
              />
              <button
                type="button"
                onClick={() => setCompat((r) => (r.length > 1 ? r.filter((x) => x.key !== row.key) : r))}
                className="text-forge-orange hover:opacity-80 sm:col-span-1"
                aria-label="Remove row"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p className="border border-forge-orange/60 bg-forge-orange/10 px-3 py-2 text-sm text-forge-orange">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="bg-forge-orange px-6 py-2 font-display uppercase tracking-[0.12em] text-blueprint-navy transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Part'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/admin')}
          className="border border-diagram-cyan/50 px-6 py-2 font-display uppercase tracking-[0.12em] text-diagram-cyan hover:bg-diagram-cyan/10"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
