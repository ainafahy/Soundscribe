import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep kokoro-js + transformers.js out of any server bundle — they're
  // browser-only (WASM / Web Workers). Prevents SSR from ever trying to
  // evaluate them, which would fail on node-only fallbacks.
  serverExternalPackages: ["kokoro-js", "@huggingface/transformers"],
};

export default nextConfig;
