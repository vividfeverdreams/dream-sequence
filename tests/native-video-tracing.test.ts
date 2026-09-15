import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

const require = createRequire(import.meta.url);
const run = promisify(execFile);
const nodeFileTrace = require("next/dist/compiled/@vercel/nft").nodeFileTrace as (
  files: string[], options: { base: string; processCwd: string }
) => Promise<{ fileList: Set<string> }>;
const glob = promisify(require("next/dist/compiled/glob")) as (
  pattern: string, options: { cwd: string; nodir: boolean; dot: boolean }
) => Promise<string[]>;

// A successful development import cannot prove that a deployed function can
// resolve a dynamically loaded optional dependency. Rebuild the traced package
// in a directory that cannot fall back to this repository's node_modules.
describe("deployed native video dependency", () => {
  it("loads the native decoder from the isolated traced package, including pnpm's dependency alias", async () => {
    const root = process.cwd();
    const entry = require.resolve("node-av/api");
    const trace = await nodeFileTrace([entry], { base: root, processCwd: root });
    const patterns = nextConfig.outputFileTracingIncludes?.["/api/sessions/*/reconcile"] ?? [];
    const aliasPatterns = patterns.filter((pattern) => pattern.includes("/node-av@"));
    const physicalPatterns = ["./node_modules/.pnpm/@seydx+node-av-*/node_modules/@seydx/**/*"];
    const oldFiles = [...trace.fileList, ...(await Promise.all(physicalPatterns.map((pattern) => glob(pattern, { cwd: root, nodir: true, dot: true })))).flat()];
    const aliasFiles = (await Promise.all(aliasPatterns.map((pattern) => glob(pattern, { cwd: root, nodir: true, dot: true })))).flat();
    const repairedFiles = [...trace.fileList, ...(await Promise.all(patterns.map((pattern) => glob(pattern, { cwd: root, nodir: true, dot: true })))).flat()];
    const nativeFiles = [...new Set(repairedFiles)].filter((file) => file.endsWith("/node-av.node"));
    expect(nativeFiles).toHaveLength(1);
    expect(nativeFiles[0]).toContain("/node-av@");
    expect(nativeFiles.some((file) => file.includes("/.pnpm/@seydx+"))).toBe(false);
    const directory = await mkdtemp(join(tmpdir(), "dream-native-trace-"));
    const copy = async (file: string) => {
      const source = resolve(root, file);
      if (!(await stat(source)).isFile()) return;
      const destination = join(directory, relative(root, source));
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
    };
    const probe = async () => {
      const { stdout } = await run(process.execPath, ["--input-type=module", "-e", `
        try {
          await import(${JSON.stringify(join(directory, relative(root, entry)))});
          process.stdout.write("loaded");
        } catch (error) {
          process.stdout.write(error.message.includes("Could not load the node-av native binding") ? "native-binding-unavailable" : "other-import-failure");
        }
      `], { cwd: directory, env: { NODE_ENV: "test" }, encoding: "utf8", timeout: 20_000 });
      return stdout;
    };
    try {
      for (const file of new Set(oldFiles)) await copy(file);
      // Reproduce the former deployment: the binary is present in the store,
      // but Node cannot resolve it from node-av's own dependency directory.
      expect(await probe()).toBe("native-binding-unavailable");
      expect(aliasFiles.some((file) => file.endsWith("/node-av.node"))).toBe(true);
      // Build the repaired package afresh: none of the physical-store files
      // from the failing package may help resolution or duplicate native bytes.
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory, { recursive: true });
      for (const file of new Set(repairedFiles)) await copy(file);
      expect(await probe()).toBe("loaded");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
