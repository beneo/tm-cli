# Authentication Setup

Qwen Code supports two main authentication methods to access AI models. Choose the method that best fits your use case:

1.  **Qwen OAuth (Recommended):**
    - Use this option to log in with your qwen.ai account.
    - During initial startup, Qwen Code will direct you to the qwen.ai authentication page. Once authenticated, your credentials will be cached locally so the web login can be skipped on subsequent runs.
    - **Requirements:**
      - Valid qwen.ai account
      - Internet connection for initial authentication
    - **Benefits:**
      - Seamless access to Qwen models
      - Automatic credential refresh
      - No manual API key management required

    **Getting Started:**

    ```bash
    # Start Qwen Code and follow the OAuth flow
    qwen
    ```

    The CLI will automatically open your browser and guide you through the authentication process.

    **For users who authenticate using their qwen.ai account:**

    **Quota:**
    - 60 requests per minute
    - 2,000 requests per day
    - Token usage is not applicable

    **Cost:** Free

    **Notes:** A specific quota for different models is not specified; model fallback may occur to preserve shared experience quality.

---

### Qwen OAuth 详细指南

#### 理解 Qwen OAuth 认证流程

Qwen Code 使用 **OAuth 2.0 Device Authorization Flow**（RFC 8628）进行身份验证。这种方式特别适合命令行工具和无法直接输入用户名密码的环境。

> 📚 **技术深度文档：** 完整的技术实现细节、API 端点、PKCE 机制等，请参阅 [OAuth Flow 技术文档](./oauth-flow.md)

**为什么使用 Device Flow？**

- 适合 CLI/终端环境
- 无需在终端中输入密码（更安全）
- 支持浏览器中的多因素认证
- 可以在无头环境中通过 URL 手动完成认证
- **无需浏览器回调** - 完全基于轮询机制

**安全增强 - PKCE（Proof Key for Code Exchange）：**

- 使用加密安全的代码质询（Code Challenge）
- 采用 SHA-256 哈希算法
- 防止授权码拦截攻击

**关键特性：**

- ✅ 无回调服务器 - CLI 通过轮询获取 token
- ✅ 跨设备授权 - 可在手机上授权，CLI 在电脑上
- ✅ 防火墙友好 - 无需开放本地端口

#### 完整的 OAuth 登录流程

**阶段 1：初始化**

1. 运行 `qwen` 命令启动 CLI
2. 系统检查 `~/.qwen/settings.json` 中的认证配置
3. 如果选择了 Qwen OAuth 或未配置认证，开始 OAuth 流程

**阶段 2：Token 检查与缓存加载** 4. 系统检查 `~/.qwen/oauth_creds.json` 是否存在有效的缓存凭证 5. 如果存在且未过期，直接使用缓存的 access token 6. 如果 token 已过期但有 refresh token，自动刷新后使用 7. 如果没有有效凭证，进入设备授权流程

**阶段 3：设备授权流程**（首次登录或 token 失效时）8. 系统生成 PKCE 代码验证器和质询码 9. 向 `https://chat.qwen.ai/api/v1/oauth2/device/code` 发送设备授权请求 10. 接收：- `device_code` - 设备代码 - `user_code` - 用户代码（例如：ABCD-1234）- `verification_uri` - 验证网址 - `verification_uri_complete` - 包含用户代码的完整网址

**阶段 4：浏览器认证** 11. CLI 自动打开浏览器到验证网址（如：`https://chat.qwen.ai/oauth/device?user_code=XXXX-XXXX`）12. 如果浏览器无法打开，终端会显示 QR 码或网址 13. 在浏览器中：- 登录您的 qwen.ai 账号 - 查看授权请求详情 - 点击"授权"按钮

**阶段 5：Token 轮询与获取**（**无浏览器回调**）

> ⚠️ **重要：** Device Flow 使用轮询机制，**不使用浏览器回调**。这是标准设计，因为 CLI 应用无法启动本地 HTTP 服务器接收回调。

14. CLI 向 token 端点发送轮询请求：
    - **URL:** `POST https://chat.qwen.ai/api/v1/oauth2/token`
    - **参数:**
      - `grant_type=urn:ietf:params:oauth:grant-type:device_code`
      - `client_id=f0304373b74a44d2b584a3fb70ca9e56`
      - `device_code` - 从阶段 3 获得的设备代码
      - `code_verifier` - 从阶段 1 生成的 PKCE 验证器

15. **轮询策略：**
    - 初始间隔：每 2 秒一次
    - 如果收到 `authorization_pending` 响应：继续轮询
    - 如果收到 `slow_down` 响应（HTTP 429）：将间隔增加 50%（最多 10 秒）
    - 最大轮询时间：30 分钟（device_code 有效期）

16. **服务器响应：**
    - **等待中:** `{ "error": "authorization_pending" }` → 继续轮询
    - **太频繁:** `{ "error": "slow_down" }` → 增加间隔后继续
    - **成功:** 返回 token：
      - `access_token` - 访问令牌（用于 API 调用）
      - `refresh_token` - 刷新令牌（用于获取新的 access token）
      - `expires_in` - 过期时间（秒，通常 3600 = 1 小时）
      - `resource_url` - API 端点 URL（可选）
    - **拒绝:** `{ "error": "access_denied" }` → 用户拒绝授权
    - **过期:** `{ "error": "expired_token" }` → device_code 已过期

**阶段 6：Token 安全存储** 17. 创建 `~/.qwen/` 目录（权限：`0o700`，仅所有者可访问）18. 将凭证写入 `~/.qwen/oauth_creds.json`（权限：`0o600`，仅所有者可读写）19. 使用原子写入操作（先写临时文件，再重命名）确保数据完整性

**阶段 7：自动 Token 使用** 20. 每次 API 请求前，自动检查 token 有效性 21. 如果距离过期时间少于 30 秒，自动触发刷新 22. API 请求携带 `Authorization: Bearer {access_token}` 头

**阶段 8：自动 Token 刷新** 23. 系统自动在后台刷新即将过期的 token 24. 使用文件锁（`~/.qwen/oauth_creds.lock`）防止多进程同时刷新 25. 刷新成功后更新缓存文件和内存中的凭证 26. 如果刷新失败（如 refresh token 过期），需要重新进行设备授权流程

**阶段 9：跨会话同步** 27. 多个 CLI 实例共享同一个 token 文件 28. 每 5 秒检查文件修改时间，自动加载其他进程刷新的 token 29. 通过文件锁机制避免竞态条件

#### 首次设置详细步骤

1. **启动 Qwen Code：**

   ```bash
   qwen
   ```

2. **选择认证方法：**
   - 系统会提示："How would you like to authenticate for this project?"
   - 选择 "Qwen OAuth"

3. **查看终端输出：**

   ```
   Please visit the following URL to authorize this application:
   https://chat.qwen.ai/oauth/device?user_code=ABCD-1234

   [QR Code displayed]

   Waiting for authorization...
   ```

4. **完成浏览器认证：**
   - 如果浏览器自动打开，直接在页面中登录
   - 如果浏览器未打开：
     - 选项 1：扫描终端显示的 QR 码
     - 选项 2：手动访问显示的 URL
     - 选项 3：使用 `Ctrl+Click`（某些终端支持）点击 URL

5. **授权确认：**
   - 在浏览器中查看应用请求的权限
   - 点击"授权"按钮

6. **等待完成：**

   ```
   ✓ Authentication successful!
   Credentials cached to: ~/.qwen/oauth_creds.json
   ```

7. **开始使用：**
   - 认证成功后，可以直接开始使用 Qwen Code
   - 后续启动会自动使用缓存的凭证，无需重新登录

#### Token 管理详解

**Token 存储位置：**

```
~/.qwen/
├── oauth_creds.json      # OAuth 凭证文件（权限：600）
├── oauth_creds.lock      # 锁文件，用于多进程同步
└── settings.json         # 用户设置
```

**oauth_creds.json 文件结构：**

```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "eyJhbGc...",
  "token_type": "Bearer",
  "expiry_date": 1234567890000,
  "resource_url": "https://dashscope.aliyuncs.com/compatible-mode/v1"
}
```

**Token 生命周期：**

- `access_token`：有效期通常为 1 小时
- `refresh_token`：有效期通常为 30 天
- 系统会在 access token 过期前 30 秒自动刷新
- 如果 refresh token 也过期，需要重新进行设备授权流程

**安全特性：**

- 文件权限严格限制为 `0o600`（仅所有者可读写）
- 目录权限限制为 `0o700`（仅所有者可访问）
- 使用原子写入操作防止文件损坏
- Token 不会在日志中明文显示

**手动管理 Token：**

清除缓存的凭证（需要重新登录）：

```bash
rm ~/.qwen/oauth_creds.json
```

查看 token 过期时间：

```bash
cat ~/.qwen/oauth_creds.json | jq '.expiry_date'
```

检查文件权限：

```bash
ls -la ~/.qwen/oauth_creds.json
# 应显示：-rw------- (600)
```

#### 多会话支持

**场景：** 您在多个终端窗口中同时运行 Qwen Code

**工作原理：**

1. 所有 CLI 实例共享同一个 `~/.qwen/oauth_creds.json` 文件
2. 当一个实例刷新 token 时：
   - 获取文件锁（`~/.qwen/oauth_creds.lock`）
   - 刷新 token
   - 更新文件
   - 释放锁
3. 其他实例会：
   - 每 5 秒检查文件修改时间
   - 发现文件被修改后自动重新加载
   - 使用最新的 token

**好处：**

- 无需在每个窗口中单独登录
- Token 自动在所有会话间同步
- 避免同时刷新导致的冲突

**注意事项：**

- 确保 `~/.qwen/` 目录没有权限问题
- 如果在 NFS 或共享文件系统上运行，文件锁可能不可靠
- 锁文件会在 10 秒后自动清理（防止死锁）

#### 常见问题排查

##### 1. 浏览器没有自动打开

**症状：** 终端显示 URL 但浏览器没有打开

**原因：**

- 运行在无头环境（SSH、Docker、WSL 等）
- 缺少 `xdg-open`（Linux）或 `open`（macOS）命令
- 浏览器未设置或无法启动

**解决方案：**

```bash
# 手动复制 URL 到浏览器
# 或扫描终端显示的 QR 码
# 或在本地机器上访问该 URL
```

##### 2. 认证超时

**症状：**

```
Error: Device authorization timeout
Please try again
```

**原因：**

- 在 5 分钟内没有完成浏览器授权
- 网络连接问题

**解决方案：**

```bash
# 重新运行 qwen 命令
qwen

# 或在 CLI 中使用 /auth 命令重新认证
/auth
```

##### 3. Token 过期错误

**症状：**

```
No cached Qwen-OAuth credentials found
```

**原因：**

- access token 和 refresh token 都已过期
- 凭证文件被删除或损坏

**解决方案：**

```bash
# 重新进行 OAuth 认证
qwen
# 选择 "Qwen OAuth" 并完成授权流程
```

##### 4. 文件权限错误

**症状：**

```
Error: EACCES: permission denied, open '~/.qwen/oauth_creds.json'
```

**原因：**

- 文件或目录权限不正确
- 文件被其他用户创建

**解决方案：**

```bash
# 修复目录权限
chmod 700 ~/.qwen

# 修复文件权限
chmod 600 ~/.qwen/oauth_creds.json

# 如果是权限问题，可能需要重新创建
rm -rf ~/.qwen/oauth_creds.json
qwen  # 重新认证
```

##### 5. 速率限制（429 错误）

**症状：**

```
Error: Too Many Requests (429)
Rate limit exceeded
```

**原因：**

- 超过每分钟 60 次请求限制
- 超过每天 2000 次请求限制

**解决方案：**

```bash
# 等待一段时间后重试
# 或切换到 OpenAI-compatible API（如果您有 API key）
/auth
# 选择 "OpenAI-compatible API"
```

##### 6. Token 刷新失败

**症状：**

```
Failed to refresh access token
Please re-authenticate
```

**原因：**

- refresh token 已过期（通常 30 天后）
- 账号权限被撤销
- 服务端问题

**解决方案：**

```bash
# 清除旧凭证
rm ~/.qwen/oauth_creds.json

# 重新认证
qwen
# 完成 OAuth 流程
```

##### 7. 多进程锁冲突

**症状：**

```
Error: Failed to acquire lock
Timeout waiting for lock file
```

**原因：**

- 另一个进程正在刷新 token
- 锁文件没有正确清理（进程崩溃）

**解决方案：**

```bash
# 等待 10 秒（锁会自动超时）
# 或手动删除陈旧的锁文件
rm ~/.qwen/oauth_creds.lock

# 如果问题持续，检查是否有僵尸进程
ps aux | grep qwen
```

#### 安全最佳实践

1. **保护凭证文件：**
   - 切勿与他人共享 `oauth_creds.json` 文件
   - 不要将其提交到 git 仓库（已在 `.gitignore` 中）
   - 在共享系统上定期检查文件权限

2. **定期重新认证：**
   - refresh token 有 30 天有效期
   - 建议定期重新登录以保持最佳安全性

3. **多用户系统：**
   - 每个用户有独立的 `~/.qwen/` 目录
   - 确保目录权限正确（`700`）

4. **日志安全：**
   - Token 不会在日志中明文显示
   - 如果需要分享日志，确保没有泄露敏感信息

5. **共享文件系统：**
   - 避免在 NFS 等网络文件系统上存储凭证
   - 文件锁在网络文件系统上可能不可靠

#### 调试模式

如果遇到问题，可以启用调试模式查看详细日志：

```bash
# 启用调试模式
export DEBUG=qwen:oauth

# 或在 .qwen/.env 中添加
echo "DEBUG=qwen:oauth" >> ~/.qwen/.env

# 运行 qwen
qwen
```

调试输出会显示：

- OAuth 流程的每个步骤
- Token 刷新时机
- 文件锁操作
- API 请求和响应（token 会被部分隐藏）

---

### Qwen OAuth API 完整参考

本节列出 Qwen OAuth 认证流程中使用的所有 API 端点和参数。

> 💡 **提示：** 这些是底层 API 细节，通常由 CLI 自动处理。如果您只是使用 OAuth 登录，无需关注这些技术细节。

#### 🌐 API 端点基础信息

**基础 URL:** `https://chat.qwen.ai`

**客户端标识:**

- **Client ID:** `f0304373b74a44d2b584a3fb70ca9e56`
- **授权类型:** OAuth 2.0 Device Flow（RFC 8628）
- **安全增强:** PKCE（RFC 7636）使用 SHA-256

---

#### 📡 API 1：请求设备授权码

**端点:** `POST /api/v1/oauth2/device/code`

**完整 URL:** `https://chat.qwen.ai/api/v1/oauth2/device/code`

**请求头:**

| 头名称         | 值                                                 | 必需 |
| -------------- | -------------------------------------------------- | ---- |
| `Content-Type` | `application/x-www-form-urlencoded`                | ✅   |
| `Accept`       | `application/json`                                 | ✅   |
| `x-request-id` | UUID（如：`550e8400-e29b-41d4-a716-446655440000`） | ❌   |

**请求参数（Form-encoded）:**

| 参数                    | 类型   | 必需 | 说明                                     | 示例值                                        |
| ----------------------- | ------ | ---- | ---------------------------------------- | --------------------------------------------- |
| `client_id`             | string | ✅   | 客户端标识符                             | `f0304373b74a44d2b584a3fb70ca9e56`            |
| `scope`                 | string | ✅   | 空格分隔的权限列表                       | `openid profile email model.completion`       |
| `code_challenge`        | string | ✅   | PKCE 代码质询（SHA-256 哈希，base64url） | `E9Mrozoa0owWoUgT5K9-BsxjQHapMbFzzwXLoIqI5Xg` |
| `code_challenge_method` | string | ✅   | 质询方法，固定为 S256                    | `S256`                                        |

**请求示例:**

```http
POST /api/v1/oauth2/device/code HTTP/1.1
Host: chat.qwen.ai
Content-Type: application/x-www-form-urlencoded
Accept: application/json

client_id=f0304373b74a44d2b584a3fb70ca9e56
&scope=openid%20profile%20email%20model.completion
&code_challenge=E9Mrozoa0owWoUgT5K9-BsxjQHapMbFzzwXLoIqI5Xg
&code_challenge_method=S256
```

**成功响应（HTTP 200）:**

```json
{
  "device_code": "ABC123DEF456GHI789JKL012MNO345PQR678STU901VWX",
  "user_code": "QWER-1234",
  "verification_uri": "https://chat.qwen.ai/oauth/device",
  "verification_uri_complete": "https://chat.qwen.ai/oauth/device?user_code=QWER-1234",
  "expires_in": 1800,
  "interval": 2
}
```

**响应字段说明:**

| 字段                        | 类型   | 说明                                                                              |
| --------------------------- | ------ | --------------------------------------------------------------------------------- |
| `device_code`               | string | 设备代码（长字符串，CLI 用于轮询 token 端点）                                     |
| `user_code`                 | string | 用户代码（短代码，如 `QWER-1234`，显示在终端中）                                  |
| `verification_uri`          | string | **基础验证网址**（用户手动访问并输入 user_code）                                  |
| `verification_uri_complete` | string | **完整验证网址**（推荐）已包含 user_code 参数，CLI 自动打开，用户无需手动输入代码 |
| `expires_in`                | number | device_code 有效期（秒，通常 1800 = 30 分钟）                                     |
| `interval`                  | number | 建议的最小轮询间隔（秒，可选）                                                    |

**URL 字段详解：**

```bash
# verification_uri（基础网址）
https://chat.qwen.ai/oauth/device
# ↑ 用户访问后需要手动输入 user_code（如 QWER-1234）

# verification_uri_complete（完整网址，推荐）
https://chat.qwen.ai/oauth/device?user_code=QWER-1234
# ↑ CLI 自动打开浏览器到这个网址，user_code 已预填，用户只需点击"授权"
```

**CLI 实际行为：**

- CLI 会自动打开 `verification_uri_complete`
- 浏览器跳转到 Qwen Chat 登录页面
- 用户登录后看到授权确认页面，`user_code` 已预填
- 用户点击"授权"按钮即可完成授权

**错误响应示例:**

```json
{
  "error": "invalid_request",
  "error_description": "Missing required parameter: client_id"
}
```

---

#### 🔄 API 2：轮询获取 Access Token

**端点:** `POST /api/v1/oauth2/token`

**完整 URL:** `https://chat.qwen.ai/api/v1/oauth2/token`

**用途:** 用 device_code 轮询获取 access_token（**无浏览器回调**）

**请求头:**

| 头名称         | 值                                  | 必需 |
| -------------- | ----------------------------------- | ---- |
| `Content-Type` | `application/x-www-form-urlencoded` | ✅   |
| `Accept`       | `application/json`                  | ✅   |

**请求参数（Form-encoded）:**

| 参数            | 类型   | 必需 | 说明                          | 示例值                                         |
| --------------- | ------ | ---- | ----------------------------- | ---------------------------------------------- |
| `grant_type`    | string | ✅   | 授权类型，固定值              | `urn:ietf:params:oauth:grant-type:device_code` |
| `client_id`     | string | ✅   | 客户端标识符                  | `f0304373b74a44d2b584a3fb70ca9e56`             |
| `device_code`   | string | ✅   | 从 API 1 获得的设备代码       | `ABC123DEF456GHI789...`                        |
| `code_verifier` | string | ✅   | PKCE 代码验证器（原始随机值） | `aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc`      |

**请求示例:**

```http
POST /api/v1/oauth2/token HTTP/1.1
Host: chat.qwen.ai
Content-Type: application/x-www-form-urlencoded
Accept: application/json

grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code
&client_id=f0304373b74a44d2b584a3fb70ca9e56
&device_code=ABC123DEF456GHI789JKL012MNO345PQR678STU901VWX
&code_verifier=aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc
```

**成功响应（HTTP 200）:**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "rt_f0304373b74a44d2b584a3fb70ca9e56_...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile email model.completion",
  "resource_url": "https://dashscope.aliyuncs.com/compatible-mode/v1"
}
```

**成功响应字段说明:**

| 字段            | 类型   | 说明                                                                       |
| --------------- | ------ | -------------------------------------------------------------------------- |
| `access_token`  | string | 访问令牌（JWT 或不透明令牌）                                               |
| `refresh_token` | string | 刷新令牌（用于获取新的 access_token）                                      |
| `token_type`    | string | 令牌类型，固定为 "Bearer"                                                  |
| `expires_in`    | number | access_token 有效期（秒，通常 3600 = 1 小时）                              |
| `scope`         | string | 授予的权限范围                                                             |
| `resource_url`  | string | **DashScope API 资源服务器端点**（可选）用于调用 AI 模型 API，非 OAuth API |

**`resource_url` 详解：**

- **用途：** 告诉 CLI 应该调用哪个 API 服务器来使用 Qwen 模型
- **默认值：** `https://dashscope.aliyuncs.com/compatible-mode/v1`（如果未返回则使用此默认值）
- **完整 URL 自动补全：** CLI 会自动添加 `https://` 协议和 `/v1` 后缀
- **使用场景：**
  - 调用 `/v1/chat/completions` 等 AI API 时的 base URL
  - 在 HTTP 请求头中使用 `Authorization: Bearer {access_token}`
- **注意：** 这**不是 OAuth 端点**，是获取 token 后用于调用 AI 服务的端点

**示例：**

```bash
# OAuth 认证端点（获取 token）
https://chat.qwen.ai/api/v1/oauth2/token

# 资源服务器端点（使用 token 调用 AI）
https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
#                                                ^^^^ 从 resource_url
```

**轮询过程中的响应（HTTP 400）:**

| error 值                | HTTP 状态 | error_description  | 客户端行为                |
| ----------------------- | --------- | ------------------ | ------------------------- |
| `authorization_pending` | 400       | 用户还未完成授权   | ⏳ 等待后继续轮询         |
| `slow_down`             | 429       | 轮询太频繁         | 🐌 增加间隔（×1.5）后继续 |
| `access_denied`         | 400       | 用户拒绝授权       | ❌ 停止轮询，报错         |
| `expired_token`         | 400       | device_code 已过期 | ⏰ 停止轮询，重新开始     |

**轮询响应示例 1（等待中）:**

```json
{
  "error": "authorization_pending",
  "error_description": "The authorization request is still pending"
}
```

**轮询响应示例 2（请求太快）:**

```json
{
  "error": "slow_down",
  "error_description": "The client is polling too frequently"
}
```

**轮询策略:**

```
初始间隔：2 秒
遇到 slow_down：间隔 × 1.5（最大 10 秒）
最大轮询时间：30 分钟（device_code 有效期）
```

---

#### 🔁 API 3：刷新 Access Token

**端点:** `POST /api/v1/oauth2/token`

**完整 URL:** `https://chat.qwen.ai/api/v1/oauth2/token`

**用途:** 用 refresh_token 获取新的 access_token

**请求头:**

| 头名称         | 值                                  | 必需 |
| -------------- | ----------------------------------- | ---- |
| `Content-Type` | `application/x-www-form-urlencoded` | ✅   |
| `Accept`       | `application/json`                  | ✅   |

**请求参数（Form-encoded）:**

| 参数            | 类型   | 必需 | 说明                           | 示例值                                    |
| --------------- | ------ | ---- | ------------------------------ | ----------------------------------------- |
| `grant_type`    | string | ✅   | 授权类型，固定为 refresh_token | `refresh_token`                           |
| `client_id`     | string | ✅   | 客户端标识符                   | `f0304373b74a44d2b584a3fb70ca9e56`        |
| `refresh_token` | string | ✅   | 之前获得的 refresh_token       | `rt_f0304373b74a44d2b584a3fb70ca9e56_...` |

**请求示例:**

```http
POST /api/v1/oauth2/token HTTP/1.1
Host: chat.qwen.ai
Content-Type: application/x-www-form-urlencoded
Accept: application/json

grant_type=refresh_token
&client_id=f0304373b74a44d2b584a3fb70ca9e56
&refresh_token=rt_f0304373b74a44d2b584a3fb70ca9e56_abcdef123456
```

**成功响应（HTTP 200）:**

```json
{
  "access_token": "新的_access_token",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "新的_refresh_token（可选）",
  "resource_url": "https://dashscope.aliyuncs.com/compatible-mode/v1"
}
```

**成功响应字段说明:**

| 字段            | 类型   | 说明                                                  |
| --------------- | ------ | ----------------------------------------------------- |
| `access_token`  | string | 新的访问令牌                                          |
| `token_type`    | string | 令牌类型，固定为 "Bearer"                             |
| `expires_in`    | number | 新 token 的有效期（秒）                               |
| `refresh_token` | string | 新的刷新令牌（可选，如果提供则替换旧的）              |
| `resource_url`  | string | **DashScope API 资源服务器端点**（可选）同 API 2 说明 |

**错误响应（HTTP 400）:**

```json
{
  "error": "invalid_grant",
  "error_description": "Refresh token has expired or been revoked"
}
```

**错误处理:**

| error 值          | 说明                           | 客户端行为                 |
| ----------------- | ------------------------------ | -------------------------- |
| `invalid_grant`   | refresh_token 无效/过期/已撤销 | 清除凭证，要求用户重新登录 |
| `invalid_request` | 请求参数格式错误               | 检查参数，修复后重试       |
| `invalid_client`  | client_id 无效                 | 使用正确的 client_id       |

---

#### 📊 OAuth 认证流程总结

```
1️⃣ 生成 PKCE 密钥对
   code_verifier: 32 字节随机值（base64url）
   code_challenge: SHA256(code_verifier) 的 base64url

2️⃣ POST /api/v1/oauth2/device/code
   发送：client_id, scope, code_challenge, code_challenge_method
   接收：device_code, user_code, verification_uri_complete

3️⃣ 用户在浏览器中授权
   打开：verification_uri_complete
   登录并点击"授权"按钮

4️⃣ 轮询 POST /api/v1/oauth2/token
   发送：grant_type=device_code, client_id, device_code, code_verifier
   等待：authorization_pending → 继续轮询
   成功：接收 access_token, refresh_token

5️⃣ 保存到 ~/.qwen/oauth_creds.json
   {
     "access_token": "...",
     "refresh_token": "...",
     "token_type": "Bearer",
     "expiry_date": timestamp,
     "resource_url": "..."
   }

6️⃣ 使用 access_token 调用 API
   Authorization: Bearer {access_token}

7️⃣ Token 过期时刷新
   POST /api/v1/oauth2/token (grant_type=refresh_token)
   获取新的 access_token
```

---

#### 🔐 安全说明

**PKCE 验证流程:**

1. 客户端生成 `code_verifier`（32 字节随机值）
2. 客户端计算 `code_challenge = SHA256(code_verifier)`
3. 客户端发送 `code_challenge` 到服务器（API 1）
4. 用户授权后，客户端发送 `code_verifier` 到服务器（API 2）
5. 服务器验证：`SHA256(接收的 code_verifier) == 存储的 code_challenge`
6. ✅ 验证通过，返回 access_token

**为什么安全？**

- ✅ `code_verifier` 从不离开客户端（除了最后的 token 请求）
- ✅ 中间人无法伪造有效的 `code_verifier`
- ✅ 即使 `device_code` 被拦截也无法使用

---

#### 🌐 完整 API 端点列表

| API               | HTTP 方法 | 端点                         | 用途                                            |
| ----------------- | --------- | ---------------------------- | ----------------------------------------------- |
| **1. 设备授权**   | POST      | `/api/v1/oauth2/device/code` | 请求 device_code 和 user_code                   |
| **2. Token 获取** | POST      | `/api/v1/oauth2/token`       | 轮询获取 access_token（grant_type=device_code） |
| **3. Token 刷新** | POST      | `/api/v1/oauth2/token`       | 刷新 access_token（grant_type=refresh_token）   |

**所有端点的基础 URL:** `https://chat.qwen.ai`

**说明：** OAuth 2.0 Device Flow 只需要这 **3 个 API 调用**（2 个端点）即可完成完整的认证流程。无需 revoke、introspect 或 userinfo 等额外端点。

---

#### 📋 API 快速参考对照表

**API 1：设备授权（Device Authorization）**

```
POST https://chat.qwen.ai/api/v1/oauth2/device/code
Content-Type: application/x-www-form-urlencoded
```

| 类型     | 参数名                      | 类型   | 必需 | 说明                                  | 示例值                                                  |
| -------- | --------------------------- | ------ | ---- | ------------------------------------- | ------------------------------------------------------- |
| **请求** | `client_id`                 | string | ✅   | 客户端 ID                             | `f0304373b74a44d2b584a3fb70ca9e56`                      |
| 请求     | `scope`                     | string | ✅   | 权限范围                              | `openid profile email model.completion`                 |
| 请求     | `code_challenge`            | string | ✅   | PKCE 质询（SHA-256）                  | `E9Mrozoa0owWoUgT...`                                   |
| 请求     | `code_challenge_method`     | string | ✅   | 质询方法                              | `S256`                                                  |
| **响应** | `device_code`               | string | ✅   | 设备代码（用于轮询）                  | `ABC123DEF456...`                                       |
| 响应     | `user_code`                 | string | ✅   | 用户代码（显示给用户）                | `QWER-1234`                                             |
| 响应     | `verification_uri`          | string | ✅   | **基础验证网址**（需手动输入code）    | `https://chat.qwen.ai/oauth/device`                     |
| 响应     | `verification_uri_complete` | string | ✅   | **完整验证网址**（推荐，CLI自动打开） | `https://chat.qwen.ai/oauth/device?user_code=QWER-1234` |
| 响应     | `expires_in`                | number | ✅   | 有效期（秒）                          | `1800`                                                  |
| 响应     | `interval`                  | number | ❌   | 建议轮询间隔（秒）                    | `2`                                                     |

---

**API 2：Token 获取（Token Polling）**

```
POST https://chat.qwen.ai/api/v1/oauth2/token
Content-Type: application/x-www-form-urlencoded
```

| 类型               | 参数名              | 类型   | 必需 | 说明                                      | 示例值                                                                    |
| ------------------ | ------------------- | ------ | ---- | ----------------------------------------- | ------------------------------------------------------------------------- |
| **请求**           | `grant_type`        | string | ✅   | 授权类型                                  | `urn:ietf:params:oauth:grant-type:device_code`                            |
| 请求               | `client_id`         | string | ✅   | 客户端 ID                                 | `f0304373b74a44d2b584a3fb70ca9e56`                                        |
| 请求               | `device_code`       | string | ✅   | 设备代码（来自 API 1）                    | `ABC123DEF456...`                                                         |
| 请求               | `code_verifier`     | string | ✅   | PKCE 验证器（原始值）                     | `aBcDeFgHiJkLmNo...`                                                      |
| **响应（成功）**   | `access_token`      | string | ✅   | 访问令牌（JWT）                           | `eyJhbGciOiJIUzI1NiI...`                                                  |
| 响应（成功）       | `refresh_token`     | string | ✅   | 刷新令牌                                  | `rt_f0304373b74a44d2b584a3fb70ca9e56_...`                                 |
| 响应（成功）       | `token_type`        | string | ✅   | 令牌类型                                  | `Bearer`                                                                  |
| 响应（成功）       | `expires_in`        | number | ✅   | 有效期（秒）                              | `3600`                                                                    |
| 响应（成功）       | `scope`             | string | ✅   | 授予的权限                                | `openid profile email model.completion`                                   |
| 响应（成功）       | `resource_url`      | string | ❌   | **DashScope资源服务器**（用于调用AI API） | `https://dashscope.aliyuncs.com/compatible-mode/v1`                       |
| **响应（轮询中）** | `error`             | string | -    | 错误代码                                  | `authorization_pending` / `slow_down` / `access_denied` / `expired_token` |
| 响应（轮询中）     | `error_description` | string | -    | 错误描述                                  | `The authorization request is still pending`                              |

---

**API 3：Token 刷新（Token Refresh）**

```
POST https://chat.qwen.ai/api/v1/oauth2/token
Content-Type: application/x-www-form-urlencoded
```

| 类型             | 参数名              | 类型   | 必需 | 说明                                      | 示例值                                                 |
| ---------------- | ------------------- | ------ | ---- | ----------------------------------------- | ------------------------------------------------------ |
| **请求**         | `grant_type`        | string | ✅   | 授权类型                                  | `refresh_token`                                        |
| 请求             | `client_id`         | string | ✅   | 客户端 ID                                 | `f0304373b74a44d2b584a3fb70ca9e56`                     |
| 请求             | `refresh_token`     | string | ✅   | 刷新令牌（来自 API 2）                    | `rt_f0304373b74a44d2b584a3fb70ca9e56_...`              |
| **响应（成功）** | `access_token`      | string | ✅   | 新的访问令牌                              | `eyJhbGciOiJIUzI1NiI...`                               |
| 响应（成功）     | `token_type`        | string | ✅   | 令牌类型                                  | `Bearer`                                               |
| 响应（成功）     | `expires_in`        | number | ✅   | 有效期（秒）                              | `3600`                                                 |
| 响应（成功）     | `refresh_token`     | string | ❌   | 新的刷新令牌（可选）                      | `rt_f0304373b74a44d2b584a3fb70ca9e56_...`              |
| 响应（成功）     | `resource_url`      | string | ❌   | **DashScope资源服务器**（用于调用AI API） | `https://dashscope.aliyuncs.com/compatible-mode/v1`    |
| **响应（失败）** | `error`             | string | -    | 错误代码                                  | `invalid_grant` / `invalid_request` / `invalid_client` |
| 响应（失败）     | `error_description` | string | -    | 错误描述                                  | `Refresh token has expired or been revoked`            |

---

#### 🔑 重要说明

**Qwen OAuth 只使用这 3 个 API：**

1. ✅ **设备授权** - 获取 device_code 和 user_code
2. ✅ **Token 获取** - 轮询获取 access_token 和 refresh_token（**无浏览器回调，纯轮询**）
3. ✅ **Token 刷新** - 使用 refresh_token 获取新的 access_token

**不需要的 API：**

- ❌ **Token 撤销（Revoke）** - 未实现，token 自动过期
- ❌ **Token 验证（Introspect）** - 未实现，token 为自包含的 JWT
- ❌ **用户信息（UserInfo）** - 未实现，用户信息包含在 token claims 中
- ❌ **登出（Logout）** - 未实现，删除本地凭证即可

**认证机制：**

- 无浏览器回调（No callback）
- 使用轮询机制（Polling）
- 轮询策略：2秒起始间隔，遇到 `slow_down` 时间隔 ×1.5（最大10秒）
- 最大轮询时长：30分钟（device_code 有效期）

---

#### 📚 相关资源

- **完整技术文档:** [OAuth Flow 技术深度解析](./oauth-flow.md)
- **配置说明:** [OAuth 凭证配置文件](./configuration.md#oauth-凭证配置文件)
- **RFC 标准:**
  - [RFC 8628 - OAuth 2.0 Device Authorization Grant](https://www.rfc-editor.org/rfc/rfc8628.html)
  - [RFC 7636 - Proof Key for Code Exchange (PKCE)](https://www.rfc-editor.org/rfc/rfc7636.html)

---

2.  **<a id="openai-api"></a>OpenAI-Compatible API:**
    - Use API keys for OpenAI or other compatible providers.
    - This method allows you to use various AI models through API keys.

    **Configuration Methods:**

    a) **Environment Variables:**

    ```bash
    export OPENAI_API_KEY="your_api_key_here"
    export OPENAI_BASE_URL="your_api_endpoint"  # Optional
    export OPENAI_MODEL="your_model_choice"     # Optional
    ```

    b) **Project `.env` File:**
    Create a `.env` file in your project root:

    ```env
    OPENAI_API_KEY=your_api_key_here
    OPENAI_BASE_URL=your_api_endpoint
    OPENAI_MODEL=your_model_choice
    ```

    **Supported Providers:**
    - OpenAI (https://platform.openai.com/api-keys)
    - Alibaba Cloud Bailian
    - ModelScope
    - OpenRouter
    - Azure OpenAI
    - Any OpenAI-compatible API

## Switching Authentication Methods

To switch between authentication methods during a session, use the `/auth` command in the CLI interface:

```bash
# Within the CLI, type:
/auth
```

This will allow you to reconfigure your authentication method without restarting the application.

### Persisting Environment Variables with `.env` Files

You can create a **`.qwen/.env`** file in your project directory or in your home directory. Creating a plain **`.env`** file also works, but `.qwen/.env` is recommended to keep Qwen Code variables isolated from other tools.

**Important:** Some environment variables (like `DEBUG` and `DEBUG_MODE`) are automatically excluded from project `.env` files to prevent interference with qwen-code behavior. Use `.qwen/.env` files for qwen-code specific variables.

Qwen Code automatically loads environment variables from the **first** `.env` file it finds, using the following search order:

1. Starting in the **current directory** and moving upward toward `/`, for each directory it checks:
   1. `.qwen/.env`
   2. `.env`
2. If no file is found, it falls back to your **home directory**:
   - `~/.qwen/.env`
   - `~/.env`

> **Important:** The search stops at the **first** file encountered—variables are **not merged** across multiple files.

#### Examples

**Project-specific overrides** (take precedence when you are inside the project):

```bash
mkdir -p .qwen
cat >> .qwen/.env <<'EOF'
OPENAI_API_KEY="your-api-key"
OPENAI_BASE_URL="https://api-inference.modelscope.cn/v1"
OPENAI_MODEL="Qwen/Qwen3-Coder-480B-A35B-Instruct"
EOF
```

**User-wide settings** (available in every directory):

```bash
mkdir -p ~/.qwen
cat >> ~/.qwen/.env <<'EOF'
OPENAI_API_KEY="your-api-key"
OPENAI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
OPENAI_MODEL="qwen3-coder-plus"
EOF
```

## Non-Interactive Mode / Headless Environments

When running Qwen Code in a non-interactive environment, you cannot use the OAuth login flow.
Instead, you must configure authentication using environment variables.

The CLI will automatically detect if it is running in a non-interactive terminal and will use the
OpenAI-compatible API method if configured:

1.  **OpenAI-Compatible API:**
    - Set the `OPENAI_API_KEY` environment variable.
    - Optionally set `OPENAI_BASE_URL` and `OPENAI_MODEL` for custom endpoints.
    - The CLI will use these credentials to authenticate with the API provider.

**Example for headless environments:**

If none of these environment variables are set in a non-interactive session, the CLI will exit with an error.

For comprehensive guidance on using Qwen COde programmatically and in
automation workflows, see the [Headless Mode Guide](../headless.md).
