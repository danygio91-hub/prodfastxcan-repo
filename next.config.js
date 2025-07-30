/** @type {import('next').NextConfig} */
const nextConfig = {
  // This allows the Next.js dev server to accept requests from the
  // Firebase Studio environment.
  allowedDevOrigins: [
    "http://localhost:3000",
    "https://*.cloudworkstations.dev",
  ],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

module.exports = nextConfig;
