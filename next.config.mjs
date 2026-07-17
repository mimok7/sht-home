/** @type {import('next').NextConfig} */
const nextConfig = {
  // Chromium resolves compressed Linux binaries relative to this package.
  // Keep the module external and trace its runtime assets into this API route.
  serverExternalPackages: ['@sparticuz/chromium'],
  outputFileTracingIncludes: {
    '/api/admin/naver-cafe-import': ['node_modules/@sparticuz/chromium/bin/**/*'],
  },
};

export default nextConfig;
