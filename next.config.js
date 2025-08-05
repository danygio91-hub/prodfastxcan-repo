/** @type {import('next').NextConfig} */
const nextConfig = {
  // This allows the Next.js dev server to accept requests from the
  // Firebase Studio environment.
  allowedDevOrigins: [
    "http://localhost:3000",
    "https://*.cloudworkstations.dev",
    "https://6000-firebase-studio-1749643731577.cluster-ombtxv25tbd6yrjpp3lukp6zhc.cloudworkstations.dev",
    "https://9000-firebase-studio-1749643731577.cluster-ombtxv25tbd6yrjpp3lukp6zhc.cloudworkstations.dev",
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
