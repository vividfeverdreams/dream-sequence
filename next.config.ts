import type { NextConfig } from "next";

const nodeAvNativeTraceFiles = [
  // node-av dynamically requires its optional platform dependency. Tracing the
  // pnpm store alone omits the dependency alias Node actually resolves at runtime.
  // Include only that alias to avoid packaging the large native binary twice.
  "./node_modules/.pnpm/node-av@*/node_modules/@seydx/**/*"
];

const nextConfig: NextConfig = {
  // node-av is a native FFmpeg binding used only by render-completion
  // functions. Keep it external so Next can trace its platform prebuild into
  // server functions without attempting to bundle a native addon.
  serverExternalPackages: ["node-av"],
  outputFileTracingIncludes: {
    "/api/r/*": nodeAvNativeTraceFiles,
    "/api/twilio/inbound": nodeAvNativeTraceFiles,
    "/api/twitch/webhook": nodeAvNativeTraceFiles,
    "/api/twitch/process": nodeAvNativeTraceFiles,
    "/api/sessions/*/control": nodeAvNativeTraceFiles,
    "/api/sessions/*/reconcile": nodeAvNativeTraceFiles,
    "/api/sessions/*/start": nodeAvNativeTraceFiles,
    "/api/sessions/*/transition": nodeAvNativeTraceFiles
  }
};

export default nextConfig;
