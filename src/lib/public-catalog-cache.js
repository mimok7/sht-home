import { revalidateTag } from 'next/cache';

const PUBLIC_CATALOG_TAGS = [
  'public-catalog',
  'public-product-detail',
  'public-cruise-listing',
  'public-hotel-listing',
];

// Route handlers are mutations. Expire these entries immediately so the
// longer public cache lifetime never delays an operator's saved change.
export function revalidatePublicCatalog() {
  for (const tag of PUBLIC_CATALOG_TAGS) revalidateTag(tag, { expire: 0 });
}
