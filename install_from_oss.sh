#!/usr/bin/env bash
# 从 OSS 安装 Qwen CLI

set -euo pipefail

# 你的 OSS 地址
OSS_URL="https://bugutech.oss-cn-hangzhou.aliyuncs.com/qwen/qwen-cli-latest.tgz"

echo "🚀 正在从 OSS 安装 Qwen CLI..."
echo "📦 下载地址: ${OSS_URL}"
echo ""

npm install -g "${OSS_URL}"

echo ""
echo "✅ 安装完成！"
echo ""
echo "验证安装："
echo "  qwen --version"
echo "  qwen --help"
