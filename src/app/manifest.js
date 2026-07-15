export default function manifest() {
  return {
    name: 'STAY HALONG | 스테이하롱',
    short_name: 'STAY HALONG',
    description: '하롱베이 현지 프리미엄 여행사',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f4ed',
    theme_color: '#06272a',
    icons: [
      { src: '/icon.png', sizes: '1254x1254', type: 'image/png', purpose: 'any maskable' },
    ],
  };
}
