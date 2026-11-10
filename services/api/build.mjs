// Bundles each Lambda handler into dist/<name>/index.mjs (Node 22, ESM).
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const handlers = ["api", "admin", "migrate", "digest", "notify"];
rmSync("dist", { recursive: true, force: true });

for (const name of handlers) {
  await build({
    entryPoints: [`src/handlers/${name}.ts`],
    outfile: `dist/${name}/index.mjs`,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    sourcemap: "inline",
    minify: true,
    // AWS SDK v3 ships with the Lambda Node 22 runtime
    external: ["@aws-sdk/*"],
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  });
  // RDS CA bundle for verified TLS to Postgres (downloaded in CI)
  if (existsSync("rds-ca.pem")) cpSync("rds-ca.pem", `dist/${name}/rds-ca.pem`);
}

mkdirSync("dist/migrate/migrations", { recursive: true });
cpSync("../../db/migrations", "dist/migrate/migrations", { recursive: true });
console.log("Built:", handlers.join(", "));
