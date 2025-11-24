# 开发指南 - Qwen CLI

## 🚀 快速开始：一键部署到本机

### 方法 1：使用 npm 命令（推荐）

```bash
npm run dev:install
```

### 方法 2：直接运行脚本

```bash
sh scripts/install_qwen_cli_robust.sh
```

---

## 📖 问题背景与解决方案

### 🐛 我们遇到的问题

#### 问题 1：TypeScript 改了但 JavaScript 没更新
**现象**：修改了 `.ts` 文件，但运行 `qwen` 命令时还是旧代码

**原因**：
- TypeScript 增量编译依赖 `.tsbuildinfo` 缓存
- 如果缓存状态错误，会认为不需要重新编译
- Monorepo 中，`packages/core` 的改动需要重新构建 dist 目录

**解决方案**：
```bash
# ❌ 错误做法
npm run clean && npm run build  # clean 会删除 node_modules，导致依赖损坏

# ✅ 正确做法
npm run dev:install  # 使用改进的脚本
```

#### 问题 2：`npm run clean` 导致依赖损坏
**现象**：运行 `npm run clean` 后出现 `Cannot find package 'lru-cache'` 错误

**原因**：
```javascript
// scripts/clean.js 第 29 行
rmSync(join(root, 'node_modules'), { recursive: true, force: true });
```
脚本删除了自己运行所需的依赖！

**解决方案**：
- 使用 bash 命令清理，不依赖 Node.js
- 保留 `node_modules`，只删除编译产物

#### 问题 3：packages/core/dist/index.d.ts 不存在
**现象**：构建 CLI 时报错 `TS6305: Output file has not been built from source file`

**原因**：
- `packages/core/index.ts` 是重新导出文件，位于根目录
- 但它没有被编译到 `dist/index.d.ts`
- 导致 `packages/cli` 无法找到类型声明

**解决方案**：
- 完全删除 dist 目录
- 删除 `.tsbuildinfo` 缓存
- 强制重新编译所有文件

---

## 🔧 脚本详解

### `install_qwen_cli_robust.sh` 做了什么？

```bash
# 1. 杀掉旧进程（避免缓存）
pkill -9 qwen

# 2. 清理编译产物（不删除 node_modules）
rm -rf dist packages/*/dist
find . -name "*.tsbuildinfo" -delete  # 删除 TS 缓存

# 3. 安装依赖（跳过 postinstall hooks）
npm install --ignore-scripts  # 避免 vscode-ide-companion 失败

# 4. 生成必要文件
npm run generate  # 生成 git-commit.js

# 5. 只构建核心 packages
npm run build --workspace=packages/core
npm run build --workspace=packages/cli

# 6. 打包并链接
npm run bundle
npm link --force
```

### 为什么跳过 vscode-ide-companion？

`vscode-ide-companion` 的 `postinstall` hook 经常失败：
```
Error: Cannot find package 'generate-license-file'
```

我们只需要 `core` 和 `cli` 来运行命令行工具，所以跳过它。

---

## 📝 开发工作流

### 修改代码后部署

```bash
# 1. 修改任何 .ts 文件
vim packages/core/src/xxx.ts

# 2. 一键部署
npm run dev:install

# 3. 在新终端测试
qwen --help
```

### 为什么需要新终端？

Node.js 缓存模块，已存在的终端可能使用旧代码。

---

## 🆚 脚本对比

| 特性 | `npm run clean && npm run build` | `npm run dev:install` |
|------|----------------------------------|----------------------|
| 清理方式 | ❌ 删除 node_modules | ✅ 只删除编译产物 |
| 依赖安全 | ❌ 可能损坏依赖 | ✅ 使用 bash 清理 |
| TS 缓存 | ❌ 不清理 .tsbuildinfo | ✅ 强制清理缓存 |
| 构建范围 | ❌ 构建所有 workspaces | ✅ 只构建 core + cli |
| 错误处理 | ❌ 无验证 | ✅ 验证关键文件 |
| 速度 | 🐢 慢（重装依赖） | 🚀 快（保留依赖） |

---

## 🎯 常见场景

### 场景 1：代码改了但不生效
```bash
npm run dev:install
```

### 场景 2：依赖更新了
```bash
rm -rf node_modules package-lock.json
npm install
npm run dev:install
```

### 场景 3：Git 切换分支后
```bash
npm run dev:install  # 确保使用新分支的代码
```

### 场景 4：完全重置（慎用）
```bash
git clean -fdx  # 删除所有未跟踪文件
npm install
npm run dev:install
```

---

## 🔍 故障排查

### "qwen: command not found"

```bash
# 检查 npm global bin 路径
npm bin -g

# 添加到 PATH（添加到 ~/.zshrc 或 ~/.bashrc）
export PATH="$(npm bin -g):$PATH"
```

### 运行的还是旧代码

```bash
# 1. 确认构建时间
stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" dist/cli.js

# 2. 确认链接正确
ls -la $(which qwen)

# 3. 打开新终端窗口
```

### 构建失败

```bash
# 查看详细错误
npm run build --workspace=packages/core -- --verbose

# 检查 node 版本
node --version  # 需要 >= 20.0.0
```

---

## 💡 最佳实践

1. ✅ **总是使用** `npm run dev:install` 来部署
2. ✅ **在新终端** 测试修改
3. ✅ **提交前检查** 构建是否通过
4. ❌ **避免使用** `npm run clean` 单独运行
5. ❌ **不要手动** 删除 dist 再构建

---

## 📚 相关文件

- `scripts/install_qwen_cli_robust.sh` - 主安装脚本
- `scripts/install_qwen_cli.sh` - 原始脚本（有已知问题）
- `scripts/build.js` - 构建所有 workspaces
- `scripts/clean.js` - 清理脚本（有依赖问题）
- `package.json` - npm 脚本定义

---

## 🤝 贡献

如果你遇到了新的部署问题，请更新此文档并改进脚本！
