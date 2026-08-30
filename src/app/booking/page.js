// 고객앱 데이터 흐름을 적용한 홈페이지 예약 시작 화면을 표시한다.
import BookingHomeClient from '@/components/booking/BookingHomeClient';
import './booking.css';

export const metadata = { title: '행복 여행 예약 | STAY HALONG' };

export default function BookingHome() {
  return <BookingHomeClient />;
}
