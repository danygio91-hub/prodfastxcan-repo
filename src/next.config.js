
/** @type {import('next').NextConfig} */

const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
});

const nextConfig = {
  /* config options here */
  experimental: {
    // This allows the Next.js dev server to accept requests from the
    // Firebase Studio environment.
    // NOTE: This key is deprecated in recent Next.js versions and has been moved.
    // Keeping the object for potential future experimental flags.
  },
  // allowedDevOrigins has been promoted from 'experimental' to a top-level key
  allowedDevOrigins: ["http://localhost:3000", "*.cloudworkstations.dev"],
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
