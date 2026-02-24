import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const withPWA = require("next-pwa")({
  dest: "public",
  disable: isDev, // don't generate SW in dev to avoid caching headaches
});

const nextConfig: NextConfig = {
  // If you run into build issues later, we can adjust settings here.
};

export default withPWA(nextConfig);
