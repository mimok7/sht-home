'use client';

import Image from 'next/image';

const mediaOrigin = String(process.env.NEXT_PUBLIC_R2_MEDIA_ORIGIN || '').replace(/\/$/, '');

function supportsOptimization(src) {
  if (typeof src !== 'string') return false;
  if (src.startsWith('/api/public-image?') || src.startsWith('/images/cruises/')) return true;
  return Boolean(mediaOrigin && src.startsWith(`${mediaOrigin}/`));
}

// Resize public catalogue images; signed/private or legacy external URLs must
// retain direct delivery rather than entering a shared optimization cache.
export default function CatalogImage({ src, alt, style, ...props }) {
  if (!src) return null;
  return <Image
    {...props}
    src={src}
    alt={alt}
    unoptimized={!supportsOptimization(src)}
    style={{ objectFit: 'cover', ...style }}
  />;
}
