'use client';

import { useCallback, useRef, useState } from 'react';
import type { UploadedImage } from '@/lib/types';

interface ImageUploaderProps {
  value: UploadedImage[];
  onChange: (images: UploadedImage[]) => void;
}

/**
 * Drag-and-drop, multi-file image uploader (build spec §8).
 *
 * Each image is resized in the browser (max 1600px, JPEG) before being sent as
 * base64 to /api/admin/upload, which forwards it to imgbb server-side. Resizing
 * keeps requests well under Vercel's serverless body limit and speeds uploads.
 * imgbb returns a `delete_url` (a web page) which we keep so the admin can
 * remove the image from imgbb manually — imgbb has no delete API.
 */

const MAX_DIM = 1600;
const JPEG_QUALITY = 0.82;

async function resizeToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new window.Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not load image'));
    el.src = dataUrl;
  });

  let { width, height } = img;
  if (width > MAX_DIM || height > MAX_DIM) {
    const scale = Math.min(MAX_DIM / width, MAX_DIM / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(img, 0, 0, width, height);

  // strip the "data:image/jpeg;base64," prefix — imgbb wants raw base64
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1];
}

export default function ImageUploader({ value, onChange }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (list.length === 0) return;
      setError(null);
      setUploading(true);
      try {
        const uploaded: UploadedImage[] = [];
        for (const file of list) {
          const base64 = await resizeToBase64(file);
          const res = await fetch('/api/admin/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64, name: file.name }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Upload failed.');
          }
          const data = await res.json();
          uploaded.push({ url: data.url, delete_url: data.delete_url ?? null });
        }
        onChange([...value, ...uploaded]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed.');
      } finally {
        setUploading(false);
      }
    },
    [onChange, value],
  );

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function move(index: number, dir: -1 | 1) {
    const next = [...value];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center border border-dashed px-4 py-8 text-center transition-colors ${
          dragging ? 'border-forge-orange bg-forge-orange/10' : 'border-diagram-cyan/50 bg-grid-line/20'
        }`}
      >
        <p className="font-display uppercase tracking-[0.12em] text-steel-white">
          {uploading ? 'Uploading…' : 'Drop images or click to upload'}
        </p>
        <p className="mt-1 text-xs text-muted-steel">
          JPEG, PNG, WebP or AVIF · multiple files · resized automatically
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {error && <p className="mt-2 text-sm text-forge-orange">{error}</p>}

      {value.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {value.map((img, i) => (
            <li key={img.url} className="relative border border-diagram-cyan/40 bg-grid-line/20">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="" className="aspect-square w-full object-cover" />
              {i === 0 && (
                <span className="absolute left-1 top-1 bg-forge-orange px-1 text-[10px] font-bold uppercase tracking-wide text-blueprint-navy">
                  Primary
                </span>
              )}
              {img.delete_url && (
                <a
                  href={img.delete_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Delete from imgbb"
                  className="absolute right-1 top-1 bg-blueprint-navy/80 px-1 text-[10px] uppercase tracking-wide text-diagram-cyan hover:text-forge-orange"
                >
                  imgbb ↗
                </a>
              )}
              <div className="flex items-center justify-between border-t border-diagram-cyan/40 bg-blueprint-navy/80 px-1 py-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="px-1 text-muted-steel hover:text-steel-white disabled:opacity-30"
                  aria-label="Move left"
                >
                  ◀
                </button>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="px-1 text-forge-orange hover:opacity-80"
                  aria-label="Remove image"
                >
                  ✕
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === value.length - 1}
                  className="px-1 text-muted-steel hover:text-steel-white disabled:opacity-30"
                  aria-label="Move right"
                >
                  ▶
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
