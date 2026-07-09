/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "20mb" }
  },
  // No bloquear el build por type-errors (Supabase no genera tipos completos sin schema)
  typescript: { ignoreBuildErrors: true },
  // No bloquear el build por warnings de lint
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "misfotosMartin.b-cdn.net" },
      { protocol: "https", hostname: "*.b-cdn.net" }
    ]
  }
};

module.exports = nextConfig;
