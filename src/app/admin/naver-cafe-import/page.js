import AdminCruiseManager from '../AdminCruiseManager';
import '../admin.css';

export const metadata = {
  title: '데이터 가져오기 | STAY HALONG',
  robots: { index: false, follow: false },
};

export default function NaverCafeImportPage() {
  return <AdminCruiseManager importOnly />;
}
