/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      // imgbb direct image URLs
      { protocol: 'https', hostname: 'i.ibb.co' },
      { protocol: 'https', hostname: '*.ibb.co' },
    ],
  },
};

module.exports = nextConfig;
