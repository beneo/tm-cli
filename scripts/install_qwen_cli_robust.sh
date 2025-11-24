#!/usr/bin/env bash
#
# 🚀 一键部署 Qwen CLI 到本机
#
# 问题背景：
# 1. TypeScript 增量编译缓存导致 .ts 改动后 .js 不更新
# 2. Monorepo 中 packages/core 改动后，packages/cli 使用的还是旧的 dist
# 3. npm run clean 会删除 node_modules，导致脚本自身依赖损坏
# 4. vscode-ide-companion 的 postinstall hook 经常失败
#
# 解决方案：
# - 完全清理所有编译产物和缓存（用 bash，不依赖 Node.js）
# - 删除 TypeScript 增量编译缓存 (.tsbuildinfo)
# - 使用 --ignore-scripts 跳过有问题的 hooks
# - 只构建必要的 packages (core + cli)
# - 详细日志 + 验证步骤
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log_step() {
    echo -e "${GREEN}==>${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# ========================================
# 步骤 1: 杀掉旧进程
# ========================================
log_step "Killing any running qwen processes..."
pkill -9 qwen 2>/dev/null || true
sleep 1

# ========================================
# 步骤 2: 清理编译产物（不删除 node_modules）
# ========================================
log_step "Cleaning all build artifacts..."

# 删除 dist 目录
log_warn "  Removing dist/"
rm -rf dist

# 删除所有 packages 的 dist
log_warn "  Removing packages/*/dist/"
find packages -maxdepth 2 -type d -name "dist" -exec rm -rf {} + 2>/dev/null || true

# 【关键】删除 TypeScript 增量编译缓存
log_warn "  Removing .tsbuildinfo cache files"
find . -name "*.tsbuildinfo" -type f -delete 2>/dev/null || true

# 删除所有编译后的 JS/Map/DTS 文件（保留源文件）
log_warn "  Removing compiled .js/.js.map/.d.ts files"
find packages -type f \( -name "*.js" -o -name "*.js.map" -o -name "*.d.ts" \) \
  ! -path "*/node_modules/*" \
  ! -path "*/coverage/*" \
  ! -path "*/i18n/locales/*.js" \
  ! -name "vitest.config.js" \
  ! -name "eslint.config.js" \
  -delete 2>/dev/null || true

# ========================================
# 步骤 3: 安装依赖（跳过 postinstall hooks）
# ========================================
log_step "Installing dependencies (without hooks)..."
# 使用 --ignore-scripts 避免 vscode-ide-companion 的 postinstall 失败
npm install --ignore-scripts

# ========================================
# 步骤 4: 生成必要的文件
# ========================================
log_step "Generating git commit info..."
npm run generate

# ========================================
# 步骤 5: 构建核心 packages
# ========================================
log_step "Building essential packages (core and cli only)..."

# 只构建 core 和 cli，跳过 vscode-ide-companion 避免错误
echo "  📦 Building packages/core..."
npm run build --workspace=packages/core

echo "  📦 Building packages/cli..."
npm run build --workspace=packages/cli

# 验证关键文件是否生成
if [ ! -f "packages/core/dist/index.d.ts" ]; then
    log_error "Build failed: packages/core/dist/index.d.ts not found!"
    exit 1
fi

if [ ! -f "packages/cli/dist/src/gemini.js" ]; then
    log_error "Build failed: packages/cli/dist/src/gemini.js not found!"
    exit 1
fi

log_step "✅ Build verification passed"

# ========================================
# 步骤 6: 打包
# ========================================
log_step "Bundling fresh distribution..."
npm run bundle

# 验证 bundle 产物
if [ ! -f "dist/cli.js" ]; then
    log_error "Bundle failed: dist/cli.js not found!"
    exit 1
fi

# ========================================
# 步骤 7: 全局链接
# ========================================
log_step "Linking CLI globally (creates 'qwen' command)..."
npm link --force

# ========================================
# 步骤 8: 验证安装
# ========================================
echo ""
log_step "🎉 Installation complete! Verifying..."

echo ""
echo "📍 Symlink location:"
ls -la "$(which qwen)" 2>/dev/null || log_warn "  'qwen' command not found in PATH"

echo ""
echo "🕐 Build timestamp:"
stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "${ROOT_DIR}/dist/cli.js" 2>/dev/null || log_warn "  dist/cli.js not found"

echo ""
echo "✨ ${GREEN}SUCCESS!${NC} Qwen CLI has been installed."
echo ""
echo "📌 ${YELLOW}IMPORTANT:${NC} Open a NEW terminal window to use the updated 'qwen' command!"
echo "   (Node.js caches modules, existing terminals may use old code)"
echo ""
echo "🧪 Verify with:"
echo "   qwen --help"
echo ""
echo "💡 If 'qwen' is not found, ensure your npm global bin is on PATH:"
echo "   export PATH=\"\$(npm bin -g):\$PATH\""
echo ""
