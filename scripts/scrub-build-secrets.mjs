import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

const generatedDevVars = resolve("dist/server/.dev.vars");
const distDir = resolve("dist");
const forbiddenBuildPatterns = [
  /mainnet\.helius-rpc\.com\/\?api-key=/i,
  /HELIUS_API_KEY\s*=/i,
  /SOLANA_POOL_PRIVATE_KEY\s*=/i,
  /SUPABASE_SERVICE_ROLE_KEY\s*=/i,
];

if (existsSync(generatedDevVars)) {
  rmSync(generatedDevVars);
  console.log("[security] Removed generated dist/server/.dev.vars");
}

function scanFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  if (forbiddenBuildPatterns.some((pattern) => pattern.test(content))) {
    throw new Error(`[security] Refusing build output with secret-like content: ${filePath}`);
  }
}

function scanDir(dirPath) {
  if (!existsSync(dirPath)) return;

  for (const entry of readdirSync(dirPath)) {
    const fullPath = resolve(dirPath, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath);
    } else if (stat.isFile()) {
      scanFile(fullPath);
    }
  }
}

scanDir(distDir);
