import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const rootDir = process.cwd();
const stagingDir = path.join(rootDir, "audit-staging");
const zipPath = path.join(rootDir, "ThesisIQ-audit.zip");

const ALLOWED_DIRS = [
  ".agents",
  ".github",
  "backend",
  "cloudflare-dispatcher",
  "data_node",
  "docs",
  "public",
  "reports",
  "scripts",
  "src",
  "supabase",
];

const ALLOWED_ROOT_FILES = [
  "AGENTS.md",
  "GEMINI.md",
  "README.md",
  "CHANGELOG.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "vitest.config.ts",
  "eslint.config.js",
  "eslint.backend.config.js",
  "components.json",
  "tailwind.config.ts",
  "postcss.config.js",
  "index.html",
  "vercel.json",
];

const EXCLUDE_PATTERNS = [
  /\.env/i,
  /node_modules/i,
  /\.git/i,
  /\.log$/i,
  /\.zip$/i,
  /\.DS_Store/i,
  /Thumbs\.db/i,
  /scratch/i,
  /dist/i,
  /logs/i,
  /node_downloader/i,
  /archive/i,
  /graphify-out/i,
];

function shouldExclude(filePath) {
  const rel = path.relative(rootDir, filePath).replace(/\\/g, "/");
  return EXCLUDE_PATTERNS.some((rx) => rx.test(rel));
}

function copyRecursive(src, dest) {
  if (shouldExclude(src)) return;
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else if (stats.isFile()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

async function main() {
  console.log("=== THESISIQ AUDIT ZIP PACKAGER ===");
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingDir, { recursive: true });

  console.log("1. Copying approved top-level files...");
  for (const f of ALLOWED_ROOT_FILES) {
    const src = path.join(rootDir, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(stagingDir, f));
    }
  }

  console.log("2. Copying approved directories...");
  for (const d of ALLOWED_DIRS) {
    const src = path.join(rootDir, d);
    if (fs.existsSync(src)) {
      copyRecursive(src, path.join(stagingDir, d));
    }
  }

  console.log(
    "3. Verifying security & privacy invariants in staging directory...",
  );
  const stagedFiles = [];
  function auditDir(dir) {
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      const rel = path.relative(stagingDir, full).replace(/\\/g, "/");
      if (shouldExclude(full)) {
        throw new Error(
          `SECURITY LEAK DETECTED: Excluded pattern matched in staging: ${rel}`,
        );
      }
      if (fs.statSync(full).isDirectory()) {
        auditDir(full);
      } else {
        stagedFiles.push(rel);
      }
    }
  }
  auditDir(stagingDir);

  const envFiles = stagedFiles.filter((f) => /\.env/i.test(f));
  if (envFiles.length > 0) {
    throw new Error(
      `SECURITY LEAK: Found .env file(s) in staging: ${envFiles.join(", ")}`,
    );
  }
  console.log(
    `Security check passed! ${stagedFiles.length} files approved for audit bundle (zero .env files).`,
  );

  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  console.log(
    "4. Creating ThesisIQ-audit.zip via PowerShell Compress-Archive...",
  );
  // Compress staging contents into zip
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${zipPath}' -Force"`,
    { stdio: "inherit" },
  );

  console.log("5. Cleaning up staging directory...");
  fs.rmSync(stagingDir, { recursive: true, force: true });

  const zipStats = fs.statSync(zipPath);
  const sizeMb = (zipStats.size / (1024 * 1024)).toFixed(2);
  console.log(`\n Audit package created successfully!`);
  console.log(`Location: ${zipPath}`);
  console.log(`Archive Size: ${sizeMb} MB`);
  console.log(`Total Files Included: ${stagedFiles.length}`);
}

main().catch((err) => {
  console.error("Failed to build audit zip:", err);
  process.exit(1);
});
