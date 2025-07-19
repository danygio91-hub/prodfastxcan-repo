
/** @type {import('next').NextConfig} */

const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
});

const nextConfig = {
  /* config options here */
  // This allows the Next.js dev server to accept requests from the
  // Firebase Studio environment.
  experimental: {
    allowedDevOrigins: ["*.cloudworkstations.dev", "http://localhost:3000"],
  },
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

// Apply PWA only in production to avoid potential conflicts with dev server features.
module.exports = process.env.NODE_ENV === 'production' ? withPWA(nextConfig) : nextConfig;
