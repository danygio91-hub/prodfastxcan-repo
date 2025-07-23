
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
  experimental: {
    // allowedForwardedHosts is intentionally left in experimental for wider version compatibility
  },
  allowedForwardedHosts: ['6000-firebase-studio-1749643731577.cluster-ombtxv25tbd6yrjpp3lukp6zhc.cloudworkstations.dev'],
  allowedDevOrigins: ["*.cloudworkstations.dev", "http://localhost:3000"],
};

// Apply PWA only in production to avoid potential conflicts with dev server features.
module.exports = process.env.NODE_ENV === 'production' ? withPWA(nextConfig) : nextConfig;
