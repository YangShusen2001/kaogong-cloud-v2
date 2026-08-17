// 生产构建前置检查：PUBLIC_API_BASE（Worker 域名）未设置时 fail-fast 中止构建，
// 兑现 docs/deployment.md 里“不配会 fail-fast 中止构建”的承诺，
// 避免把 http://127.0.0.1:8787 烤进线上产物。
if (!process.env.PUBLIC_API_BASE) {
  console.error("[kaogong] 生产构建缺少 PUBLIC_API_BASE（Worker 域名），已中止构建。");
  console.error("          请在构建前设置，例如（PowerShell）：");
  console.error('            $env:PUBLIC_API_BASE = "https://api.example.com"');
  console.error("          或（bash）：");
  console.error('            export PUBLIC_API_BASE="https://api.example.com"');
  process.exit(1);
}
