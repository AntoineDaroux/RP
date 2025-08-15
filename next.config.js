/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Autorise le chargement runtime de ces paquets (sans les bundler)
    serverComponentsExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  },
  webpack(config, { isServer }) {
    if (isServer) {
      // Empêche Webpack d'essayer de résoudre des deps optionnelles de Playwright
      config.externals = config.externals || [];
      config.externals.push(
        "chromium-bidi",
        "electron",
        "fsevents",
        "bufferutil",
        "utf-8-validate",
        "ws"
      );
    }
    return config;
  },
};

module.exports = nextConfig;
