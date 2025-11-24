#!/usr/bin/env bash
# Simple installer to build and link the qwen CLI locally so `qwen` is available in any terminal.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Killing any running qwen processes..."
# Ensure all qwen processes are stopped to prevent old code from running
pkill -9 qwen 2>/dev/null || true
sleep 1

cd "${ROOT_DIR}"

echo "==> Force cleaning all builds..."
# Force remove dist and all package builds for completely fresh start
rm -rf dist

echo "==> Cleaning old compiled JS files..."
# Remove all old .js, .js.map, .d.ts files to force fresh compilation
# Exclude i18n/locales/*.js which are source files, not compiled
find packages -type f \( -name "*.js" -o -name "*.js.map" -o -name "*.d.ts" \) \
  ! -path "*/node_modules/*" \
  ! -path "*/coverage/*" \
  ! -path "*/i18n/locales/*" \
  ! -name "vitest.config.js" \
  ! -name "eslint.config.js" \
  -delete 2>/dev/null || true

npm run clean || true

echo "==> Installing dependencies (without hooks)..."
# Install dependencies without running prepare hook to avoid premature bundling
npm install --ignore-scripts

echo "==> Generating git commit info..."
# Generate git-commit.js required by build
npm run generate

echo "==> Building essential packages (core and cli)..."
# Build only essential packages, skip vscode-ide-companion to avoid errors
npm run build --workspace=packages/core --workspace=packages/cli

echo "==> Building fresh bundle..."
# Now bundle the freshly built packages
npm run bundle

echo "==> Linking CLI globally (creates the 'qwen' command)..."
# Use --force to overwrite any existing symlink
npm link --force

echo ""
echo "==> Verifying installation..."
echo "Symlink location:"
ls -la "$(which qwen)" 2>/dev/null || echo "  Warning: qwen command not found in PATH"

echo ""
echo "Build timestamp:"
stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "${ROOT_DIR}/dist/cli.js" 2>/dev/null || echo "  Warning: dist/cli.js not found"

echo ""
echo "==> Done! Installation complete."
echo ""
echo "IMPORTANT: Open a NEW terminal window to use the updated qwen command!"
echo "           (Node.js caches modules, so existing terminals may use old code)"
echo ""
echo "Verify with:"
echo "    qwen --help"
echo ""
echo "If 'qwen' is not found, ensure your npm global bin is on PATH."
