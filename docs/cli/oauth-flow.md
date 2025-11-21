# Qwen OAuth 技术深度解析

本文档详细说明 Qwen Code 的 OAuth 2.0 Device Flow 认证机制的技术实现细节。

## 目录

- [架构概览](#架构概览)
- [OAuth 2.0 Device Flow 标准](#oauth-20-device-flow-标准)
- [PKCE 安全机制](#pkce-安全机制)
- [完整认证流程](#完整认证流程)
- [API 端点详解](#api-端点详解)
- [轮询机制](#轮询机制)
- [Token 管理](#token-管理)
- [多进程同步](#多进程同步)
- [错误处理](#错误处理)

---

## 架构概览

### 为什么使用 Device Flow？

OAuth 2.0 Device Flow（RFC 8628）专门为**输入受限设备**设计，特别适合：

- **命令行工具** - 无法直接接收浏览器回调
- **跨设备授权** - 用户可在手机上授权，CLI 在电脑上运行
- **无头环境** - SSH、Docker 等环境中也能完成认证
- **更好的安全性** - 不需要暴露本地 HTTP 端口

### 核心特点

✅ **无回调机制** - 完全基于轮询，不需要本地服务器
✅ **PKCE 增强** - 防止授权码拦截攻击
✅ **跨设备支持** - 浏览器和 CLI 可以在不同设备上
✅ **自动 Token 刷新** - 无缝的凭证管理

---

## OAuth 2.0 Device Flow 标准

### RFC 8628 协议流程

```
+----------+                                +----------------+
|          |>---(1) Client Identifier ----->|                |
|          |                                |                |
|          |<---(2) Device Code,          --|                |
|          |        User Code,              |                |
|  Client  |        & Verification URI      |                |
|  Device  |                                |                |
|          |  [---(3) User Interaction --->]|                |
|          |                                |  Authorization |
|          |>---(4) Polling for Token ----->|     Server     |
|          |                                |                |
|          |<---(5) Access Token ----------|                |
+----------+   (w/ Optional Refresh Token) +----------------+
```

**关键点：**

- **(1)** 客户端向授权服务器请求设备码
- **(2)** 服务器返回 device_code、user_code、verification_uri
- **(3)** 用户在浏览器中访问 verification_uri 并授权
- **(4)** 客户端轮询 token 端点（**没有浏览器回调**）
- **(5)** 授权完成后，服务器返回 access_token

---

## PKCE 安全机制

### 什么是 PKCE？

**Proof Key for Code Exchange（RFC 7636）** - 代码交换证明密钥

PKCE 通过加密质询-响应机制，防止授权码拦截攻击。

### 实现细节

#### 1. 生成 Code Verifier（代码验证器）

```typescript
// 生成 32 字节随机值，base64url 编码
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// 示例输出：
// "aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc"
// 长度：43 个字符
```

**特征：**

- 长度：32 字节（256 位）
- 编码：base64url（URL 安全）
- 熵：高度随机，不可预测

#### 2. 生成 Code Challenge（代码质询）

```typescript
// 用 SHA-256 哈希 code_verifier
function generateCodeChallenge(codeVerifier: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(codeVerifier);
  return hash.digest('base64url');
}

// 示例：
// 输入：aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc
// 输出：E9Mrozoa0owWoUgT5K9-BsxjQHapMbFzzwXLoIqI5Xg
```

**哈希方法：**

- 算法：SHA-256
- 编码：base64url
- 不可逆：无法从 challenge 推导出 verifier

#### 3. PKCE 验证流程

```
客户端                             授权服务器
   |                                     |
   |--1. /device/code------------------->|
   |   code_challenge: E9Mrozoa...       |
   |   code_challenge_method: S256       |
   |                                     |
   |<--device_code, user_code------------|
   |                                     |
   |   用户在浏览器中授权...              |
   |                                     |
   |--2. /token------------------------->|
   |   device_code: ABC123...            |
   |   code_verifier: aBcDeFg...         |
   |                                     |
   |                         [验证]      |
   |                  SHA256(aBcDeFg..) ==? E9Mrozoa...
   |                         ✅ 匹配     |
   |                                     |
   |<--access_token, refresh_token-------|
```

**安全保证：**

- ✅ code_verifier 从不离开客户端
- ✅ 中间人无法伪造有效的 code_verifier
- ✅ 即使 device_code 被拦截也无法使用

---

## 完整认证流程

### 阶段 1：PKCE 密钥对生成

```typescript
// 文件：packages/core/src/qwen/qwenOAuth2.ts

const pkce = generatePKCEPair();
// 返回：
// {
//   code_verifier: "aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc",
//   code_challenge: "E9Mrozoa0owWoUgT5K9-BsxjQHapMbFzzwXLoIqI5Xg"
// }
```

### 阶段 2：请求设备授权码

**HTTP 请求：**

```http
POST /api/v1/oauth2/device/code HTTP/1.1
Host: chat.qwen.ai
Content-Type: application/x-www-form-urlencoded
Accept: application/json
x-request-id: 550e8400-e29b-41d4-a716-446655440000

client_id=f0304373b74a44d2b584a3fb70ca9e56
&scope=openid%20profile%20email%20model.completion
&code_challenge=E9Mrozoa0owWoUgT5K9-BsxjQHapMbFzzwXLoIqI5Xg
&code_challenge_method=S256
```

**参数说明：**

| 参数                    | 值                                      | 说明                          |
| ----------------------- | --------------------------------------- | ----------------------------- |
| `client_id`             | `f0304373b74a44d2b584a3fb70ca9e56`      | Qwen Code 应用的客户端 ID     |
| `scope`                 | `openid profile email model.completion` | 请求的权限范围                |
| `code_challenge`        | `E9Mrozoa...`                           | PKCE 代码质询（SHA-256 哈希） |
| `code_challenge_method` | `S256`                                  | 质询方法（SHA-256）           |

**响应示例：**

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

**响应字段说明：**

| 字段                        | 类型   | 说明                                           |
| --------------------------- | ------ | ---------------------------------------------- |
| `device_code`               | string | 设备代码，用于后续轮询（长字符串）             |
| `user_code`                 | string | 用户代码，显示给用户（短代码，如 "QWER-1234"） |
| `verification_uri`          | string | 用户访问的基础 URL                             |
| `verification_uri_complete` | string | 包含用户代码的完整 URL（推荐）                 |
| `expires_in`                | number | device_code 有效期（秒，通常 1800 = 30分钟）   |
| `interval`                  | number | 建议的轮询间隔（秒，可选字段）                 |

### 阶段 3：用户浏览器授权

**CLI 行为：**

```typescript
// 1. 自动打开浏览器
await open(verificationUriComplete);

// 2. 如果浏览器打开失败，显示：
console.log('Please visit the following URL to authorize:');
console.log(verificationUriComplete);
console.log('\nOr scan this QR code:');
displayQRCode(verificationUriComplete);

// 3. 开始轮询
await pollForToken(deviceCode, codeVerifier);
```

**用户浏览器中的步骤：**

1. 访问 `https://chat.qwen.ai/oauth/device?user_code=QWER-1234`
2. 登录 qwen.ai 账号（如果未登录）
3. 查看应用请求的权限：
   - **openid** - 基本身份信息
   - **profile** - 用户资料
   - **email** - 电子邮件地址
   - **model.completion** - 模型 API 访问权限
4. 点击"授权"按钮
5. 看到成功消息："授权成功，您可以关闭此窗口"

**服务器端状态变化：**

```
device_code: ABC123... → 状态: pending
  ↓（用户点击授权）
device_code: ABC123... → 状态: authorized
```

### 阶段 4：轮询获取 Token（核心机制）

**为什么是轮询而不是回调？**

| 机制       | Device Flow（轮询）     | Authorization Code Flow（回调） |
| ---------- | ----------------------- | ------------------------------- |
| 使用场景   | CLI、IoT 设备、智能电视 | Web 应用、移动应用              |
| 回调服务器 | ❌ 不需要               | ✅ 需要本地 HTTP 服务器         |
| 跨设备支持 | ✅ 支持                 | ❌ 不支持                       |
| 防火墙友好 | ✅ 无需开放端口         | ❌ 需要端口可访问               |
| 实现复杂度 | 简单（仅轮询）          | 复杂（服务器+路由）             |

**轮询实现：**

```typescript
async function pollForToken(deviceCode: string, codeVerifier: string) {
  const POLL_INTERVAL_MS = 2000; // 2 秒
  const MAX_INTERVAL_MS = 10000; // 最大 10 秒
  const TIMEOUT_MS = 1800 * 1000; // 30 分钟

  let currentInterval = POLL_INTERVAL_MS;
  const startTime = Date.now();

  while (true) {
    // 检查超时
    if (Date.now() - startTime > TIMEOUT_MS) {
      throw new Error('Device authorization timeout');
    }

    // 发送轮询请求
    const response = await fetch('https://chat.qwen.ai/api/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: 'f0304373b74a44d2b584a3fb70ca9e56',
        device_code: deviceCode,
        code_verifier: codeVerifier,
      }),
    });

    const data = await response.json();

    // 处理响应
    if (response.ok && data.access_token) {
      // ✅ 成功获取 token
      return data;
    }

    if (data.error === 'authorization_pending') {
      // ⏳ 用户还未授权，继续等待
      await sleep(currentInterval);
      continue;
    }

    if (data.error === 'slow_down') {
      // 🐌 服务器要求降低轮询频率
      currentInterval = Math.min(currentInterval * 1.5, MAX_INTERVAL_MS);
      await sleep(currentInterval);
      continue;
    }

    if (data.error === 'access_denied') {
      // ❌ 用户拒绝授权
      throw new Error('User denied authorization');
    }

    if (data.error === 'expired_token') {
      // ⏰ device_code 已过期
      throw new Error('Device code expired');
    }

    // 其他错误
    throw new Error(data.error_description || data.error);
  }
}
```

**轮询时序图：**

```
时间  CLI 操作                    服务器响应                      说明
────────────────────────────────────────────────────────────────────
0s    POST /token                authorization_pending          等待用户授权
      ↓ 等待 2 秒
2s    POST /token                authorization_pending          用户打开浏览器
      ↓ 等待 2 秒
4s    POST /token                authorization_pending          用户登录中...
      ↓ 等待 2 秒
6s    POST /token                authorization_pending
      ↓ 等待 2 秒
8s    POST /token                slow_down (429)                服务器限流
      ↓ 等待 3 秒（间隔×1.5）
11s   POST /token                authorization_pending
      ↓ 等待 3 秒
14s   POST /token                authorization_pending          用户点击授权！
      ↓ 等待 3 秒
17s   POST /token                ✅ access_token                成功！
```

---

## API 端点详解

### 端点 1：设备授权请求

**URL:** `POST https://chat.qwen.ai/api/v1/oauth2/device/code`

**请求头：**

```
Content-Type: application/x-www-form-urlencoded
Accept: application/json
x-request-id: <UUID>  (可选，用于请求追踪)
```

**请求参数：**

| 参数                    | 必需 | 类型   | 说明                       |
| ----------------------- | ---- | ------ | -------------------------- |
| `client_id`             | ✅   | string | 客户端标识符               |
| `scope`                 | ✅   | string | 空格分隔的权限列表         |
| `code_challenge`        | ✅   | string | PKCE 代码质询（base64url） |
| `code_challenge_method` | ✅   | string | 固定为 "S256"              |

**成功响应（HTTP 200）：**

```json
{
  "device_code": "string (长，不透明)",
  "user_code": "string (短，用户可读)",
  "verification_uri": "string (URL)",
  "verification_uri_complete": "string (URL with code)",
  "expires_in": 1800,
  "interval": 2
}
```

**错误响应示例：**

```json
{
  "error": "invalid_request",
  "error_description": "Missing required parameter: client_id"
}
```

### 端点 2：Token 轮询/交换

**URL:** `POST https://chat.qwen.ai/api/v1/oauth2/token`

**请求头：**

```
Content-Type: application/x-www-form-urlencoded
Accept: application/json
```

**请求参数（Device Code Grant）：**

| 参数            | 必需 | 类型   | 说明                                           |
| --------------- | ---- | ------ | ---------------------------------------------- |
| `grant_type`    | ✅   | string | `urn:ietf:params:oauth:grant-type:device_code` |
| `client_id`     | ✅   | string | 客户端标识符                                   |
| `device_code`   | ✅   | string | 从设备授权请求获得的 device_code               |
| `code_verifier` | ✅   | string | PKCE 代码验证器（原始随机值）                  |

**成功响应（HTTP 200）：**

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

**轮询中的响应（HTTP 400）：**

| error 值                | HTTP 状态 | 说明             | 客户端行为         |
| ----------------------- | --------- | ---------------- | ------------------ |
| `authorization_pending` | 400       | 用户还未授权     | 继续轮询           |
| `slow_down`             | 429       | 轮询太频繁       | 增加间隔后继续     |
| `access_denied`         | 400       | 用户拒绝授权     | 停止轮询，报错     |
| `expired_token`         | 400       | device_code 过期 | 停止轮询，重新开始 |

**错误响应示例：**

```json
{
  "error": "authorization_pending",
  "error_description": "The authorization request is still pending"
}
```

### 端点 3：Token 刷新

**URL:** `POST https://chat.qwen.ai/api/v1/oauth2/token`

**请求参数（Refresh Token Grant）：**

| 参数            | 必需 | 类型   | 说明                     |
| --------------- | ---- | ------ | ------------------------ |
| `grant_type`    | ✅   | string | `refresh_token`          |
| `client_id`     | ✅   | string | 客户端标识符             |
| `refresh_token` | ✅   | string | 之前获得的 refresh_token |

**成功响应（HTTP 200）：**

```json
{
  "access_token": "新的_access_token",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "新的_refresh_token（可选）",
  "resource_url": "https://..."
}
```

**刷新失败（HTTP 400）：**

```json
{
  "error": "invalid_grant",
  "error_description": "Refresh token has expired or been revoked"
}
```

**处理逻辑：**

- 如果返回新的 `refresh_token`，替换旧的
- 如果未返回，继续使用旧的 `refresh_token`
- 如果刷新失败（400），清除凭证，要求重新授权

---

## 轮询机制

### 轮询策略详解

```typescript
// 初始配置
const config = {
  initialInterval: 2000, // 初始间隔 2 秒
  maxInterval: 10000, // 最大间隔 10 秒
  intervalMultiplier: 1.5, // 遇到 slow_down 时的倍增系数
  maxDuration: 1800000, // 最大轮询时间 30 分钟
};

// 轮询状态
let currentInterval = config.initialInterval;
let attempts = 0;
let totalTime = 0;

// 轮询循环
while (totalTime < config.maxDuration) {
  attempts++;

  const response = await pollTokenEndpoint();

  switch (response.status) {
    case 'success':
      // ✅ 获取到 token，退出循环
      return response.tokens;

    case 'pending':
      // ⏳ 继续等待
      if (response.slowDown) {
        // 🐌 服务器要求降速
        currentInterval = Math.min(
          currentInterval * config.intervalMultiplier,
          config.maxInterval,
        );
      }
      await sleep(currentInterval);
      totalTime += currentInterval;
      break;

    case 'denied':
    case 'expired':
      // ❌ 终止错误
      throw new Error(response.error);
  }
}

// ⏰ 超时
throw new Error('Device authorization timeout');
```

### 轮询间隔自适应

**正常流程：**

```
请求 1: 间隔 2秒
请求 2: 间隔 2秒
请求 3: 间隔 2秒
...
```

**遇到 slow_down：**

```
请求 1: 间隔 2秒
请求 2: 间隔 2秒
请求 3: → slow_down → 间隔调整为 3秒
请求 4: 间隔 3秒
请求 5: → slow_down → 间隔调整为 4.5秒
请求 6: 间隔 4.5秒
...
请求 N: 间隔 10秒 (达到上限)
```

**计算公式：**

```
新间隔 = min(当前间隔 × 1.5, 10秒)
```

### 轮询终止条件

| 条件              | 触发                         | 结果              |
| ----------------- | ---------------------------- | ----------------- |
| 获得 access_token | `response.access_token` 存在 | ✅ 成功返回       |
| 用户拒绝授权      | `error: "access_denied"`     | ❌ 抛出错误       |
| device_code 过期  | `error: "expired_token"`     | ❌ 抛出错误       |
| 轮询超时          | 超过 30 分钟                 | ⏰ 抛出超时错误   |
| 网络错误          | fetch 失败                   | 🔄 重试或抛出错误 |

---

## Token 管理

### Token 存储

**文件路径：** `~/.qwen/oauth_creds.json`

**文件权限：**

- 目录：`~/.qwen/` → `0o700` (drwx------)
- 文件：`oauth_creds.json` → `0o600` (-rw-------)

**存储格式：**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM...",
  "refresh_token": "rt_f0304373b74a44d2b584a3fb70ca9e56_abcdef123456...",
  "token_type": "Bearer",
  "expiry_date": 1734567890000,
  "resource_url": "https://dashscope.aliyuncs.com/compatible-mode/v1"
}
```

### Token 生命周期

**时间线：**

```
T=0     获取 access_token (expires_in: 3600秒)
        expiry_date = now + 3600000 (毫秒)

T=3570  系统检测: now >= expiry_date - 30000
        ↓ 触发自动刷新

T=3570  POST /token (refresh_token grant)
        ↓ 获取新 token

T=3570  更新 oauth_creds.json
        新的 expiry_date = now + 3600000

T=7140  再次检测到即将过期...
        ↓ 循环往复
```

**有效性检查：**

```typescript
function isTokenValid(credentials: QwenCredentials): boolean {
  // 1. 检查必需字段
  if (!credentials.access_token || !credentials.expiry_date) {
    return false;
  }

  // 2. 检查是否过期（含30秒缓冲）
  const now = Date.now();
  const expiryWithBuffer = credentials.expiry_date - 30000;

  return now < expiryWithBuffer;
}
```

### 原子写入机制

```typescript
async function saveCredentials(credentials: QwenCredentials) {
  const targetPath = '~/.qwen/oauth_creds.json';

  // 1. 写入临时文件
  const tempPath = `${targetPath}.tmp.${randomUUID()}`;
  await fs.writeFile(tempPath, JSON.stringify(credentials, null, 2), {
    mode: 0o600,
  });

  // 2. 原子重命名（覆盖目标文件）
  await fs.rename(tempPath, targetPath);

  // 优点：
  // - 避免写入中断导致的文件损坏
  // - 其他进程读取时要么看到旧数据，要么看到新数据
  // - 没有中间状态
}
```

---

## 多进程同步

### 场景

用户在多个终端窗口同时运行 `qwen` 命令：

```bash
# 终端 1
qwen "help me debug"

# 终端 2
qwen "review code"

# 终端 3
qwen "write tests"
```

所有实例共享同一个 `~/.qwen/oauth_creds.json` 文件。

### 同步机制

**文件锁实现：**

```typescript
// 锁文件路径
const lockPath = '~/.qwen/oauth_creds.lock';

// 锁文件内容
interface LockFile {
  lockId: string; // UUID，非 PID（更安全）
  timestamp: number; // 获取锁的时间（毫秒）
}

// 获取锁
async function acquireLock(): Promise<string> {
  const lockId = randomUUID();
  const lockData = {
    lockId,
    timestamp: Date.now(),
  };

  // 尝试独占创建锁文件（flag: 'wx'）
  try {
    await fs.writeFile(lockPath, JSON.stringify(lockData), {
      flag: 'wx',
      mode: 0o600,
    });
    return lockId; // 成功获取锁
  } catch (error) {
    if (error.code === 'EEXIST') {
      // 锁文件已存在，检查是否陈旧
      const existingLock = JSON.parse(await fs.readFile(lockPath, 'utf8'));

      const lockAge = Date.now() - existingLock.timestamp;
      if (lockAge > 10000) {
        // 10 秒
        // 锁已陈旧，删除并重试
        await fs.unlink(lockPath);
        return acquireLock(); // 递归重试
      }

      // 锁仍然有效，等待后重试
      await sleep(100);
      return acquireLock();
    }
    throw error;
  }
}

// 释放锁
async function releaseLock(lockId: string) {
  try {
    const lockData = JSON.parse(await fs.readFile(lockPath, 'utf8'));

    // 只释放自己持有的锁
    if (lockData.lockId === lockId) {
      await fs.unlink(lockPath);
    }
  } catch {
    // 锁文件可能已被其他进程删除，忽略错误
  }
}
```

### Token 刷新同步流程

```
进程 A                    进程 B                    进程 C
  |                         |                         |
  | 检测 token 即将过期      |                         |
  | ↓                       |                         |
  | acquireLock()           |                         |
  | ✅ 获得锁               |                         |
  |                         |                         |
  | 刷新 token              | 检测 token 即将过期      |
  | ↓                       | ↓                       |
  | POST /token             | acquireLock()           |
  | (refresh_token)         | ⏳ 等待锁...            |
  | ↓                       |                         |
  | 获得新 token            |                         | 检测 token 即将过期
  | ↓                       |                         | ↓
  | 写入文件                |                         | acquireLock()
  | ↓                       |                         | ⏳ 等待锁...
  | releaseLock()           |                         |
  | ✅ 释放锁               |                         |
  |                         | ❌ 锁已释放，重新检查    |
  |                         | ↓                       |
  |                         | 读取文件                |
  |                         | ✅ token 已是最新       |
  |                         | 无需刷新                | ✅ token 已是最新
  |                         |                         | 无需刷新
```

### 文件监控机制

```typescript
class SharedTokenManager {
  private lastModifiedTime: number = 0;
  private cachedCredentials: QwenCredentials | null = null;

  // 每 5 秒检查一次文件
  private startFileWatcher() {
    setInterval(async () => {
      const stats = await fs.stat(credentialsPath);
      const currentModTime = stats.mtimeMs;

      if (currentModTime > this.lastModifiedTime) {
        // 文件被其他进程更新，重新加载
        this.cachedCredentials = await this.loadFromFile();
        this.lastModifiedTime = currentModTime;
      }
    }, 5000);
  }

  async getValidCredentials(): Promise<QwenCredentials> {
    // 1. 检查内存缓存
    if (this.isTokenValid(this.cachedCredentials)) {
      return this.cachedCredentials;
    }

    // 2. 从文件加载（可能被其他进程更新）
    const credentials = await this.loadFromFile();

    // 3. 检查文件中的 token 是否有效
    if (this.isTokenValid(credentials)) {
      this.cachedCredentials = credentials;
      return credentials;
    }

    // 4. 需要刷新，获取锁
    const lockId = await this.acquireLock();

    try {
      // 5. 再次检查（其他进程可能已刷新）
      const latestCredentials = await this.loadFromFile();
      if (this.isTokenValid(latestCredentials)) {
        return latestCredentials;
      }

      // 6. 执行刷新
      const newCredentials = await this.refreshToken();

      // 7. 保存到文件
      await this.saveToFile(newCredentials);

      return newCredentials;
    } finally {
      // 8. 释放锁
      await this.releaseLock(lockId);
    }
  }
}
```

---

## 错误处理

### 设备授权阶段错误

| 错误码                    | HTTP | 说明           | 处理                 |
| ------------------------- | ---- | -------------- | -------------------- |
| `invalid_request`         | 400  | 请求参数错误   | 检查参数，修复后重试 |
| `invalid_client`          | 401  | client_id 无效 | 使用正确的 client_id |
| `invalid_scope`           | 400  | scope 参数无效 | 检查 scope 格式      |
| `server_error`            | 500  | 服务器内部错误 | 重试                 |
| `temporarily_unavailable` | 503  | 服务暂时不可用 | 等待后重试           |

### Token 轮询阶段错误

| 错误码                  | HTTP | 说明             | 处理        |
| ----------------------- | ---- | ---------------- | ----------- |
| `authorization_pending` | 400  | 用户未授权       | ⏳ 继续轮询 |
| `slow_down`             | 429  | 轮询太频繁       | 🐌 增加间隔 |
| `access_denied`         | 400  | 用户拒绝         | ❌ 停止轮询 |
| `expired_token`         | 400  | device_code 过期 | ⏰ 重新开始 |

### Token 刷新阶段错误

| 错误码            | HTTP | 说明                    | 处理               |
| ----------------- | ---- | ----------------------- | ------------------ |
| `invalid_grant`   | 400  | refresh_token 无效/过期 | 清除凭证，重新授权 |
| `invalid_request` | 400  | 请求格式错误            | 检查请求参数       |
| `server_error`    | 500  | 服务器错误              | 重试               |

### 错误处理最佳实践

```typescript
class OAuth2ErrorHandler {
  async handleError(error: any, context: string) {
    // 1. 网络错误
    if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
      throw new Error(`Network error: Please check your internet connection`);
    }

    // 2. HTTP 错误
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;

      switch (status) {
        case 400:
          if (data.error === 'invalid_grant') {
            // refresh_token 过期，清除凭证
            await clearCredentials();
            throw new CredentialsClearRequiredError(
              'Please re-authenticate using /auth command',
            );
          }
          break;

        case 429:
          // 速率限制
          throw new RateLimitError(
            'Too many requests. Please try again later.',
          );

        case 500:
        case 502:
        case 503:
          // 服务器错误，可以重试
          throw new RetryableError('Server error. Will retry automatically.');
      }
    }

    // 3. 其他错误
    throw error;
  }
}
```

---

## 安全考虑

### PKCE 防护

**防止的攻击：**

- ✅ 授权码拦截攻击
- ✅ 中间人攻击
- ✅ 恶意客户端冒充

**工作原理：**

```
攻击者尝试拦截 device_code：

1. 正常客户端发送 code_challenge
2. 攻击者截获 device_code
3. 攻击者尝试用 device_code 获取 token
4. ❌ 失败！因为攻击者没有 code_verifier
5. 服务器验证失败：SHA256(攻击者的猜测) ≠ code_challenge
```

### Token 安全存储

**威胁模型：**

- ✅ 防止其他用户读取 token
- ✅ 防止进程间意外泄露
- ⚠️ 不防止 root 用户访问
- ⚠️ 不防止物理访问磁盘

**缓解措施：**

```bash
# 1. 限制文件权限
chmod 600 ~/.qwen/oauth_creds.json  # 仅所有者可读写
chmod 700 ~/.qwen/                   # 仅所有者可访问

# 2. 不要在多用户系统上运行
# 3. 不要在不受信任的环境中运行
# 4. 定期重新认证（refresh_token 30天过期）
```

### 网络安全

**HTTPS 保护：**

- ✅ 所有 API 请求使用 HTTPS
- ✅ TLS 1.2+ 加密
- ✅ 证书验证

**不要在代码中硬编码：**

```typescript
// ❌ 错误
const credentials = {
  access_token: 'eyJhbGc...', // 永远不要硬编码 token
};

// ✅ 正确
const credentials = await loadFromSecureStorage();
```

---

## 参考资料

### RFC 标准

- **RFC 8628**: OAuth 2.0 Device Authorization Grant
  - https://www.rfc-editor.org/rfc/rfc8628.html

- **RFC 7636**: Proof Key for Code Exchange by OAuth Public Clients
  - https://www.rfc-editor.org/rfc/rfc7636.html

- **RFC 6749**: The OAuth 2.0 Authorization Framework
  - https://www.rfc-editor.org/rfc/rfc6749.html

### 相关文档

- [Authentication Setup](./authentication.md) - OAuth 用户指南
- [Configuration](./configuration.md) - OAuth 配置文件说明
- [Troubleshooting](../support/troubleshooting.md) - 常见问题排查

### 代码参考

- `packages/core/src/qwen/qwenOAuth2.ts` - OAuth 客户端实现
- `packages/core/src/qwen/sharedTokenManager.ts` - Token 管理器
- `packages/core/src/qwen/qwenContentGenerator.ts` - API 集成
- `packages/cli/src/ui/hooks/useQwenAuth.ts` - UI 集成
