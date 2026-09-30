/** @type {import('next').NextConfig} */
const apiUrl = process.env.API_URL ?? 'http://localhost:5000';

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    // Same-origin proxy to the API so the browser never needs CORS and tokens stay off third-party origins.
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
