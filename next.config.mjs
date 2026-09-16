/** @type {import('next').NextConfig} */
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
  },
};

export default nextConfig;
