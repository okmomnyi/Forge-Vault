'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Category } from '@/lib/types';

interface FilterBarProps {
  categories: Category[];
  makes: string[];
  models: string[];
}

const controlClass =
  'border border-diagram-cyan/40 bg-grid-line/30 px-3 py-2 text-sm text-steel-white outline-none focus:border-diagram-cyan';

export default function FilterBar({ categories, makes, models }: FilterBarProps) {
  const router = useRouter();
  const params = useSearchParams();

  const [search, setSearch] = useState(params.get('search') ?? '');

  // Keep the search box in sync if the URL changes elsewhere (e.g. back button).
  useEffect(() => {
    setSearch(params.get('search') ?? '');
  }, [params]);

  function apply(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) sp.set(key, value);
      else sp.delete(key);
    }
    router.push(`/parts?${sp.toString()}`);
  }

  return (
    <div className="panel flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-end">
      <form
        className="flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ search });
        }}
      >
        <label className="label-plate text-[10px]" htmlFor="search">
          Search
        </label>
        <input
          id="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name or part number"
          className={`${controlClass} mt-1 w-full font-mono`}
        />
      </form>

      <div>
        <label className="label-plate text-[10px]" htmlFor="category">
          Category
        </label>
        <select
          id="category"
          className={`${controlClass} mt-1 w-full sm:w-40`}
          value={params.get('category') ?? ''}
          onChange={(e) => apply({ category: e.target.value })}
        >
          <option value="">All</option>
          {categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label-plate text-[10px]" htmlFor="make">
          Make
        </label>
        <select
          id="make"
          className={`${controlClass} mt-1 w-full sm:w-36`}
          value={params.get('make') ?? ''}
          onChange={(e) => apply({ make: e.target.value })}
        >
          <option value="">All</option>
          {makes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label-plate text-[10px]" htmlFor="model">
          Model
        </label>
        <select
          id="model"
          className={`${controlClass} mt-1 w-full sm:w-36`}
          value={params.get('model') ?? ''}
          onChange={(e) => apply({ model: e.target.value })}
        >
          <option value="">All</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={() => router.push('/parts')}
        className="border border-diagram-cyan/50 px-4 py-2 text-sm uppercase tracking-wide text-diagram-cyan hover:bg-diagram-cyan/10"
      >
        Clear
      </button>
    </div>
  );
}
