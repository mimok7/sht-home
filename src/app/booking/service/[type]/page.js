// 서비스 유형에 맞는 플랫폼 연동 예약 입력 화면을 표시한다.
import PlatformBookingForm from '@/components/booking/PlatformBookingForm';
import '../../booking.css';

export default async function BookingServicePage({ params }) {
  const { type } = await params;
  return <PlatformBookingForm type={type} />;
}
