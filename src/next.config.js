
/** @type {import('next').NextConfig} */

const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
});

const nextConfig = {
  // This allows the Next.js dev server to accept requests from the
  // Firebase Studio environment.
  experimental: {
    // This is now empty, but kept for potential future experimental flags.
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
