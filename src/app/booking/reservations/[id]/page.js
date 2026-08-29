import { ReservationDetailView } from '@/components/booking/ReservationDetailViews';

export default async function ReservationDetailPage({ params }) {
  const { id } = await params;
  return <ReservationDetailView reservationId={id} />;
}
