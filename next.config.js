/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      // routes App Router
      '/api/aliae': ['node_modules/playwright-core/.local-browsers/**'],
      '/api/sanef': ['node_modules/playwright-core/.local-browsers/**']
    }
  }
};
module.exports = nextConfig;
