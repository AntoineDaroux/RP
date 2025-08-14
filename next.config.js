/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      'app/api/aliae/route': ['node_modules/playwright-core/.local-browsers/**'],
      'app/api/sanef/route': ['node_modules/playwright-core/.local-browsers/**']
    }
  }
};
module.exports = nextConfig;
