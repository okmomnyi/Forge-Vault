'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { PartImage } from '@/lib/types';

/**
 * Product image gallery. Large active image + thumbnail strip on desktop; on
 * mobile the thumbnail strip scrolls horizontally (swipe) and taps swap the
 * active image.
 */
export default function PartGallery({ images, alt }: { images: PartImage[]; alt: string }) {
  const [active, setActive] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex aspect-square w-full items-center justify-center border border-diagram-cyan/40 bg-grid-line/20 font-mono text-sm text-muted-steel">
        no image
      </div>
    );
  }

  const current = images[Math.min(active, images.length - 1)];

  return (
    <div>
      <div className="relative aspect-square w-full border border-diagram-cyan/40 bg-grid-line/20">
        <Image
          src={current.image_url}
          alt={alt}
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-contain"
        />
      </div>

      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActive(i)}
              className={`relative h-16 w-16 flex-shrink-0 border ${
                i === active ? 'border-forge-orange' : 'border-diagram-cyan/40'
              }`}
              aria-label={`View image ${i + 1}`}
            >
              <Image src={img.image_url} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
