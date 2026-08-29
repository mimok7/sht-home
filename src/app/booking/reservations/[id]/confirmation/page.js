import { ReservationConfirmationView } from '@/components/booking/ReservationDetailViews';

export default async function ReservationConfirmationPage({ params }) {
  const { id } = await params;
  return <ReservationConfirmationView reservationId={id} />;
}
