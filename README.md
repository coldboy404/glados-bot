# GLaDOS 多账号自动签到 Bot ☁️

Telegram bot，自动签到 GLaDOS；支持多账号 Cookie 管理和健康监控。

## 能干吗

- **GLaDOS 签到** — 多账号每天自动签到；所有 GLaDOS 域名统一为一个账户入口，自动回退可用域名。
- **Cookie 自动识别** — GLaDOS 从 `koa:sess` 查询账户邮箱，并按邮箱更新去重。
- **健康监控** — 菜单显示账号状态；Cookie 失效自动标红，签到失败主动推送告警。
- **Telegram 管理** — 绑定账号、看状态、手动签到，都在对话框完成。

## Cloudflare Pages 版（新增）

原 Workers 版保持不变；Pages 版复用同一份业务代码，支持原有 Telegram 菜单、多账号、域名回退和签到结果通知。

### 1. 创建 Pages 项目

在 Cloudflare → Workers & Pages → 创建 → **Pages** → 连接此 GitHub 仓库：

- 生产分支：`main`
- 框架预设：None
- 构建命令：`npm run build:pages`
- 构建输出目录：`pages/dist`
- 根目录：仓库根目录，留空即可

这是 Pages Git 集成，不是 Workers Builds；不要使用 `npx wrangler deploy`。构建脚本从 `worker.js` 生成 advanced-mode `_worker.js`，无需手动复制代码，也不需要安装依赖。根目录的 `wrangler.toml` 仍只服务原 Workers 版，没有 `pages_build_output_dir`，不作为 Pages 配置；Pages 绑定和变量在 Dashboard 设置。

### 2. 设置生产环境绑定和变量

Pages 项目 → Settings → Bindings，添加 KV 绑定 **`GLADOS_DB`**，选择已有命名空间可保留原账号和偏好。Settings → Variables and Secrets 配置：

| 名称 | 类型 | 值 |
|---|---|---|
| `BOT_TOKEN` | Secret | BotFather Token |
| `ADMIN_ID` | Secret 或 Text | 管理员 Telegram 数字 ID |
| `WEBHOOK_URL` | Text | `https://你的Pages域名/webhook`，也支持自定义域名 |

修改绑定或变量后重新部署生产环境。不要在预览环境配置同一个生产 Bot Token，以免预览部署抢占 webhook。

### 3. 启用自动签到和 Token 自动恢复

**Pages 不支持 Cron Triggers**。仓库提供外部 GitHub Actions 定时器，每五分钟通过受密钥保护的 `POST /internal/cron` 驱动 Pages；实际签到仍遵循 Telegram 菜单设置的北京时间小时，按当前管理员、每天去重。请求会等待本轮任务结束，不依赖 Pages 的短生命周期后台任务。

GitHub 仓库 → Settings → Secrets and variables → Actions：

- Variables：`PAGES_URL` = `https://你的Pages域名`（仅 origin，不加路径）
- Secrets：`BOT_TOKEN` = 与 Pages 相同的机器人 Token（复用，不需要额外密钥）

部署完成后进入 Actions → **Pages scheduled tasks** → Run workflow，首次运行会注册 Telegram webhook 和命令。以后更换 `BOT_TOKEN`，重新部署后由定时器自动恢复。未设置 `PAGES_URL` 时，此工作流会跳过，不影响原 Workers 用户。

GitHub 定时任务可能延迟，不保证整点或五分钟 SLA；若整小时都未触发，会错过当天设置时段。需要更稳定的调度时，可改用自己的定时器每五分钟向同一路径 POST，并发送 `Authorization: Bearer <BOT_TOKEN>`，不要同时开启多个定时器。KV 的去重不是原子锁，仓库工作流通过 concurrency 串行执行。超大账号批次仍受 Cloudflare 请求/子请求配额和 HTTP 超时约束，超时不等于后台一定完成，应检查 Telegram 实际结果。

**从 Workers 迁移：**在停用旧 Worker 的业务 Cron 后再开启 Pages 定时器，避免重复执行；同一个 Bot 只能有一个 webhook，注册 Pages 地址会将 Telegram 消息切换到 Pages。不要直接删除旧 KV。原 Worker 的 Token 自动恢复 Cron 也应关闭，避免把 webhook 改回旧地址。

本地验证：`npm test && npm run build:pages && node --check pages/dist/_worker.js`。本仓库仅构建 Pages 产物，不会自动创建或部署新的 Cloudflare 项目。

## Workers 版部署

在 Cloudflare Dashboard 的 `glados-bot` 中配置 `BOT_TOKEN`、`ADMIN_ID` 和 `WEBHOOK_URL`。

| 变量 | 类型 | 值 |
|---|---|---|
| `BOT_TOKEN` | Secret | Telegram BotFather 的机器人 Token |
| `ADMIN_ID` | Secret 或 Text | 管理员的纯数字 Telegram 用户 ID |
| `WEBHOOK_URL` | Text | Worker 的固定完整 webhook 地址，例如 `https://你的域名/webhook` |

在 Cloudflare 修改 `BOT_TOKEN` 后无需再访问 `/setup`：部署生效后最多五分钟，Bot 会用 `WEBHOOK_URL` 自动重新注册 webhook，并同步只保留 `/start` 命令。`ADMIN_ID` 修改随部署即时生效。根路径只返回运行状态，不会调用 Telegram API。

> ⚠️  按钮需要 `wrangler.toml` 的 `kv_namespaces` 里**不要写** `id` 字段（包括 `id = ""`），否则按钮页面报"无法获取存储库内容"。

### Cloudflare GitHub 自动部署

本项目使用 Cloudflare Dashboard 的 GitHub 集成部署。Cloudflare 默认执行 `npx wrangler deploy`，每次仓库更新后会自动部署 `worker.js`。

请只在 Cloudflare Dashboard 中配置一次以下变量：

`Workers & Pages` → `glados-bot` → `Settings` → `Variables and Secrets`

| 名称 | 类型 | 值 |
|------|------|----|
| `BOT_TOKEN` | Secret | Telegram BotFather 的机器人 Token |
| `ADMIN_ID` | Secret 或 Text | 你的 Telegram 用户 ID |

`wrangler.toml` 已配置 `keep_vars = true`。Cloudflare GitHub 自动部署时会保留 Dashboard 中已保存的变量，不会因为仓库配置里没有写入 Token/ID 而将它们清空。

如果 Cloudflare 的构建设置里手动填写了 `npx wrangler deploy`，保持即可。不要把真实的 `BOT_TOKEN` 写进 GitHub；只在 Cloudflare Dashboard 的 Variables and Secrets 中保存一次。

## 绑定账号

在 Telegram 里跟 bot 聊。手动批量签到和每天定时签到都会逐个显示 GLaDOS 账号结果；账号较多时会自动拆分成多条消息，避免 Telegram 长度限制。

- **GLaDOS**：点「添加账号」→ 选择唯一的 `glados.network` → 直接发送完整 Cookie。Bot 会在多个互通域名中验证 Cookie、自动读取邮箱，并按邮箱更新已有账户。
Cookie 不要删减。

## 抓 Cookie（Surge / Loon / QX / Egern）

```
https://raw.githubusercontent.com/Linsars/Surge/main/sg/glados.yaml
```

Surge 模块，Egern 也兼容。装上后进各站点的「设置→账户」页面，模块自动捞 cookie。

### 手动也行

浏览器 F12 → Application → Cookies，右键复制全部 Cookie，发给 bot。

## 环境变量

| 变量 | 干啥的 | 哪来的 |
|------|-------|-------|
| `BOT_TOKEN` | Telegram Bot Token | [@BotFather](https://t.me/BotFather) |
| `ADMIN_ID` | 你（管理员）的用户 ID | [@userinfobot](https://t.me/userinfobot) |
| `GLADOS_DB` | KV Namespace ID | 一键部署时自动生成 |

## License

MIT

爱改就改，反正我写完了。
