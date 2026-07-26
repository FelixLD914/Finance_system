import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// ZWT 与 BOI 系统在同一台开发机上并行运行，端口一律使用 "BOI + 100" 偏移，
// 避免占用 BOI 的 5173/4173/8000。需要临时改口时用 ZWT_DEV_PORT /
// ZWT_PREVIEW_PORT / ZWT_API_TARGET 覆盖，不要改本文件的默认值。
const DEFAULT_DEV_PORT = 5273;
const DEFAULT_PREVIEW_PORT = 4273;
const DEFAULT_API_TARGET = "http://127.0.0.1:8100";

function readPort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535
    ? parsed
    : fallback;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "ZWT_");
  const devPort = readPort(
    process.env.ZWT_DEV_PORT ?? env.ZWT_DEV_PORT,
    DEFAULT_DEV_PORT,
  );
  const previewPort = readPort(
    process.env.ZWT_PREVIEW_PORT ?? env.ZWT_PREVIEW_PORT,
    DEFAULT_PREVIEW_PORT,
  );
  const apiTarget =
    process.env.ZWT_API_TARGET || env.ZWT_API_TARGET || DEFAULT_API_TARGET;

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: devPort,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: previewPort,
      strictPort: true,
    },
    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
});
