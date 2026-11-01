import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Le preview Arena sert l'app depuis un hôte *.e2b.app : on l'autorise
  // explicitement pour le serveur de développement.
  allowedDevOrigins: ["*.e2b.app", "*.arena.ai", "localhost", "127.0.0.1"],
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [360, 480, 640, 1024, 1280, 1920],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Le preview Arena affiche le site dans une iframe d'un autre
          // domaine : X-Frame-Options: SAMEORIGIN la casserait. On exprime la
          // même intention en CSP, en autorisant explicitement l'hôte de
          // prévisualisation.
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://*.e2b.app https://*.arena.ai",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/video/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/models/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
