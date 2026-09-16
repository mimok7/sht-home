/** @type {import('next').NextConfig} */
const r2PublicMediaUrl = String(process.env.NEXT_PUBLIC_R2_MEDIA_ORIGIN || '').trim();
let r2PublicMediaPattern;
try {
  const url = new URL(r2PublicMediaUrl);
  if (url.protocol === 'https:') {
    r2PublicMediaPattern = { protocol: 'https', hostname: url.hostname, port: url.port, pathname: '/**' };
  }
} catch {
  // The media domain is optional until the R2 custom domain is connected.
}

const nextConfig = {
  allowedDevOrigins: ['stayhalong.com'],
  // Chromium resolves compressed Linux binaries relative to this package.
  // Keep the module external and trace its runtime assets into this API route.
  serverExternalPackages: ['@sparticuz/chromium'],
  outputFileTracingIncludes: {
    '/api/admin/naver-cafe-import': ['node_modules/@sparticuz/chromium/bin/**/*'],
  },
  images: {
    // Catalogue image paths include a validated R2 key in the query string.
    // Allow only this internal proxy and the existing local media paths.
    localPatterns: [
      { pathname: '/api/public-image' },
      { pathname: '/stayhalong_title.png', search: '' },
      { pathname: '/images/cruises/**', search: '' },
    ],
    remotePatterns: r2PublicMediaPattern ? [r2PublicMediaPattern] : [],
  },
};

export default nextConfig;
