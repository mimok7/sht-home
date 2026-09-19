import ProductDetailClient from './ProductDetailClient';
import { getCachedPublicProductDetail } from '@/lib/public-product-detail-source';

export default async function ProductDetailPage({ params }) {
  const { id } = await params;
  const decodedId = decodeURIComponent(id);
  let initialDetail = null;

  try {
    initialDetail = await getCachedPublicProductDetail('cruise', decodedId, false);
  } catch (error) {
    console.error('[product-detail] initial lookup failed', error?.message || error);
  }

  return <ProductDetailClient key={id} id={id} initialDetail={initialDetail} />;
}
