import './globals.css';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import GlobalAlert from '../components/GlobalAlert';

export const metadata = {
  title: 'STAY HALONG | 스테이하롱 - 하롱베이 현지 프리미엄 여행사',
  description: '하롱베이 크루즈 예약, 당일 투어, 차량 렌트, 호텔 예약 등 하롱베이 여행의 모든 것',
  manifest: '/manifest.webmanifest',
};

export const viewport = {
  themeColor: '#06272a',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>
        <Header />
        <main className="main-content">
          {children}
          <GlobalAlert />
        </main>
        <Footer />
      </body>
    </html>
  );
}
