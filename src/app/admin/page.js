import AdminCruiseManager from './AdminCruiseManager';
import './admin.css';

export const metadata = {
  title: '데이터 관리 | STAY HALONG',
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminCruiseManager />;
}
