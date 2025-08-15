/** @type {import('next').NextConfig} */
const shared = ['node_modules/playwright-core/.local-browsers/**'];

const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      'app/api/aliae/route': shared,
      'app/api/sanef/route': shared,
      'app/api/diag/route': shared
    }
  }
};

module.exports = nextConfig;
