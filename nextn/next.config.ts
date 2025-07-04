
import type {NextConfig} from 'next';

const withPWA = require('next-pwa')({
  dest: 'public',
  disable: false, // Re-enabled for development to allow install prompt testing
  register: true,
  skipWaiting: true,
  cacheOnFrontEndNav: true,
});

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["https://*.cloudworkstations.dev"],
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

export default withPWA(nextConfig);
