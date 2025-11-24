#!/usr/bin/env bash
#
# 📦 打包 Qwen CLI 并准备上传到 OSS
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

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

echo ""
log_step "📦 打包 Qwen CLI for OSS"
echo ""

# ========================================
# 步骤 1: 清理并构建
# ========================================
log_step "构建项目..."
npm run dev:install

# ========================================
# 步骤 2: 获取包信息
# ========================================
PACKAGE_NAME=$(node -p "require('./package.json').name")
PACKAGE_VERSION=$(node -p "require('./package.json').version")

log_info "包名: ${PACKAGE_NAME}"
log_info "版本: ${PACKAGE_VERSION}"

# ========================================
# 步骤 3: 打包成 .tgz
# ========================================
log_step "创建 npm 包..."

npm pack

# 生成的文件名（npm pack 会自动命名）
# @qwen-code/qwen-code -> qwen-code-qwen-code-0.3.0.tgz
TGZ_FILE=$(ls -t *.tgz | head -1)

log_info "已创建: ${TGZ_FILE}"

# ========================================
# 步骤 4: 创建友好的文件名副本
# ========================================
FRIENDLY_NAME="qwen-cli-${PACKAGE_VERSION}.tgz"
LATEST_NAME="qwen-cli-latest.tgz"

cp "${TGZ_FILE}" "${FRIENDLY_NAME}"
cp "${TGZ_FILE}" "${LATEST_NAME}"

log_info "已创建友好命名: ${FRIENDLY_NAME}"
log_info "已创建最新版本: ${LATEST_NAME}"

# ========================================
# 步骤 5: 显示文件信息
# ========================================
echo ""
log_step "📊 打包完成！"
echo ""

echo "生成的文件："
ls -lh *.tgz

FILE_SIZE=$(du -h "${TGZ_FILE}" | cut -f1)
echo ""
log_info "包大小: ${FILE_SIZE}"

# ========================================
# 步骤 6: 提供上传指南
# ========================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_step "📤 下一步：上传到 OSS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "${BLUE}方法 1：使用 ossutil 命令行工具（推荐）${NC}"
echo ""
echo "安装 ossutil："
echo "  ${GREEN}wget https://gosspublic.alicdn.com/ossutil/1.7.15/ossutil64${NC}"
echo "  ${GREEN}chmod 755 ossutil64${NC}"
echo ""
echo "配置（首次）："
echo "  ${GREEN}./ossutil64 config${NC}"
echo ""
echo "上传文件："
echo "  ${GREEN}./ossutil64 cp ${FRIENDLY_NAME} oss://your-bucket/npm-packages/${NC}"
echo "  ${GREEN}./ossutil64 cp ${LATEST_NAME} oss://your-bucket/npm-packages/${NC}"
echo ""
echo "设置公开读取："
echo "  ${GREEN}./ossutil64 set-acl oss://your-bucket/npm-packages/${FRIENDLY_NAME} public-read${NC}"
echo "  ${GREEN}./ossutil64 set-acl oss://your-bucket/npm-packages/${LATEST_NAME} public-read${NC}"
echo ""

echo "${BLUE}方法 2：使用阿里云控制台（简单）${NC}"
echo ""
echo "1. 访问 https://oss.console.aliyun.com/"
echo "2. 选择你的 Bucket"
echo "3. 上传文件："
echo "   - ${FRIENDLY_NAME}"
echo "   - ${LATEST_NAME}"
echo "4. 设置文件为 '公共读'"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_step "🚀 用户安装命令"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "上传后，用户可以使用以下命令安装："
echo ""
echo "${GREEN}# 安装指定版本${NC}"
echo "npm install -g https://your-bucket.oss-cn-hangzhou.aliyuncs.com/npm-packages/${FRIENDLY_NAME}"
echo ""
echo "${GREEN}# 安装最新版本${NC}"
echo "npm install -g https://your-bucket.oss-cn-hangzhou.aliyuncs.com/npm-packages/${LATEST_NAME}"
echo ""

log_warn "请将 'your-bucket' 和 'oss-cn-hangzhou' 替换为你的实际配置"
echo ""

# ========================================
# 步骤 7: 创建安装脚本
# ========================================
cat > install_from_oss.sh << 'INSTALL_SCRIPT'
#!/usr/bin/env bash
# 从 OSS 安装 Qwen CLI

set -euo pipefail

# 配置你的 OSS 信息
OSS_BUCKET="your-bucket"
OSS_REGION="oss-cn-hangzhou"
PACKAGE_NAME="qwen-cli-latest.tgz"

OSS_URL="https://${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com/npm-packages/${PACKAGE_NAME}"

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
INSTALL_SCRIPT

chmod +x install_from_oss.sh

log_info "已创建安装脚本: install_from_oss.sh"
log_warn "记得修改脚本中的 OSS 配置！"

echo ""
