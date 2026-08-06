import type { NextConfig } from "next";

module.exports = {
  serverExternalPackages: ['sharp'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'i.scdn.co' }],
  },
};

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
