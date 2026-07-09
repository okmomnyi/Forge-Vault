'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/admin';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Login failed.');
        setSubmitting(false);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError('Network error. Try again.');
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="panel w-full max-w-sm p-8">
        <h1 className="font-display text-2xl uppercase tracking-[0.14em] text-steel-white">
          Forge Admin
        </h1>
        <p className="mt-1 text-sm text-muted-steel">Sign in to manage the catalog.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="label-plate text-xs" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full border border-diagram-cyan/40 bg-grid-line/30 px-3 py-2 text-steel-white outline-none focus:border-diagram-cyan"
            />
          </div>
          <div>
            <label className="label-plate text-xs" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full border border-diagram-cyan/40 bg-grid-line/30 px-3 py-2 text-steel-white outline-none focus:border-diagram-cyan"
            />
          </div>

          {error && (
            <p className="border border-forge-orange/60 bg-forge-orange/10 px-3 py-2 text-sm text-forge-orange">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-forge-orange px-4 py-2 font-display uppercase tracking-[0.12em] text-blueprint-navy transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
