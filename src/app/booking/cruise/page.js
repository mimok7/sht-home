// 기존 크루즈 예약 진입 경로를 통합 플랫폼 예약 입력 화면으로 연결한다.
import PlatformBookingForm from '@/components/booking/PlatformBookingForm';
import '../booking.css';

export default function CruiseBookingPage() {
  return <PlatformBookingForm type="cruise" />;
}
