#!/usr/bin/env bash
#
# 🚀 简化版安装 Qwen CLI（无需登录）
#
# 使用方法：
#   bash install_qwen_simple.sh
#   或: curl -fsSL [URL] | bash
#
set -euo pipefail

# 颜色输出
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_step() {
    echo -e "${GREEN}==>${NC} $1"
}

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
    exit 1
}

echo ""
log_step "🚀 安装 Qwen CLI（简化版 - 无需登录）"
echo ""

# ========================================
# 步骤 1: 检查 Node.js
# ========================================
log_step "检查 Node.js 环境..."

if ! command -v node &> /dev/null; then
    log_error "未找到 Node.js，请先安装 Node.js >= 20.0.0"
fi

NODE_VERSION=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

if [ "$NODE_MAJOR" -lt 20 ]; then
    log_error "Node.js 版本过低（当前: $NODE_VERSION），需要 >= 20.0.0"
fi

log_info "Node.js 版本: $NODE_VERSION ✓"

# ========================================
# 步骤 2: 保存原始 registry
# ========================================
ORIGINAL_REGISTRY=$(npm config get registry)
log_info "当前 registry: $ORIGINAL_REGISTRY"

# ========================================
# 步骤 3: 设置阿里云效 registry（只读，无需登录）
# ========================================
log_step "设置阿里云效 npm 仓库..."

ALIYUN_REGISTRY="https://packages.aliyun.com/5f5840b4df9df74e36b00684/npm/npm-registry/"
npm config set registry "$ALIYUN_REGISTRY"

# 关闭 always-auth，允许匿名读取
npm config set always-auth false

log_info "已设置 registry: $ALIYUN_REGISTRY"
log_info "已设置 always-auth: false（允许匿名读取）"

# ========================================
# 步骤 4: 安装 Qwen CLI（无需登录）
# ========================================
log_step "安装 Qwen CLI（无需登录）..."

if npm install -g @qwen-code/qwen-code; then
    log_info "安装成功 ✓"
else
    log_error "安装失败，可能需要登录或仓库权限配置有误"
fi

# ========================================
# 步骤 5: 验证安装
# ========================================
log_step "验证安装..."

if ! command -v qwen &> /dev/null; then
    log_warn "qwen 命令未找到，可能需要添加到 PATH"

    NPM_BIN=$(npm bin -g)
    echo ""
    echo "请将以下行添加到 ~/.zshrc 或 ~/.bashrc："
    echo "  ${GREEN}export PATH=\"$NPM_BIN:\$PATH\"${NC}"
    echo ""
    echo "然后运行："
    echo "  ${GREEN}source ~/.zshrc${NC}  # 或 source ~/.bashrc"
    echo ""
else
    QWEN_VERSION=$(qwen --version 2>&1 | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1 || echo "unknown")
    log_info "qwen 版本: $QWEN_VERSION ✓"
fi

# ========================================
# 步骤 6: 询问是否恢复原始 registry
# ========================================
echo ""
read -p "是否恢复原始 npm registry？[y/N] " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    log_step "恢复原始 npm registry..."
    npm config set registry "$ORIGINAL_REGISTRY"
    npm config set always-auth true
    log_info "已恢复 registry: $ORIGINAL_REGISTRY"
else
    log_info "保持阿里云效 registry"
    log_warn "如需恢复，请运行："
    echo "  npm config set registry $ORIGINAL_REGISTRY"
fi

# ========================================
# 完成
# ========================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_step "✅ 安装完成！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🎉 Qwen CLI 已安装成功！"
echo ""
echo "📝 快速开始："
echo "   ${GREEN}qwen --help${NC}     # 查看帮助"
echo "   ${GREEN}qwen --version${NC}  # 查看版本"
echo ""
