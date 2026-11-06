# GLaDOS 多账号自动签到 Bot ☁️

Telegram bot，自动签到 GLaDOS；支持多账号 Cookie 管理和健康监控。

## 能干吗

- **GLaDOS 签到** — 多账号每天自动签到；所有 GLaDOS 域名统一为一个账户入口，自动回退可用域名。
- **Cookie 自动识别** — GLaDOS 从 `koa:sess` 查询账户邮箱，并按邮箱更新去重。
- **健康监控** — 菜单显示账号状态；Cookie 失效自动标红，签到失败主动推送告警。
- **Telegram 管理** — 绑定账号、看状态、手动签到，都在对话框完成。

## 订阅格式

单账号和批量提取均返回 **Mihomo / Clash、sing-box、通用 / Shadowrocket** 三种订阅。通用链接为官网的 Servers only 节点订阅，不包含完整分流配置。sing-box 使用官网独立的 `hashed` 参数，要求核心版本 ≥ 1.14.0；若官网未返回某种格式所需参数，机器人会单独提示，其他可用链接仍正常显示。

## Workers 自动部署（推荐）

推送 `main` 会运行 **Deploy Worker**：先测试，再部署 `wrangler.toml` 中的 `glados-bot`，保留 Dashboard 变量。GitHub Actions Secrets 需要 `CLOUDFLARE_API_TOKEN`（仅目标账户的 Workers Scripts 编辑、Workers KV 读取、账户设置读取权限）和 `CLOUDFLARE_ACCOUNT_ID`。不要将临时 OAuth 登录凭据作为长期 CI Token。缺少凭据时部署 job 会跳过并在 Summary 明示，不代表已经发布。

运行时在 Worker 配置 `BOT_TOKEN`、`ADMIN_ID`、`WEBHOOK_URL`。KV `GLADOS_DB` 不写死命名空间 id：首次部署时由 Wrangler 在目标账号自动创建并绑定，fork 到任意账号连接 Cloudflare 即可直接部署，之后保持绑定。原生 Cron 负责定时执行：实际签到遵循 Telegram 菜单设置的北京时间小时，按当前管理员、每天去重；允许迟到补签（当天任意一次触发在设定小时之后都会执行）、失败自动释放当天执行权并在当天内重试（最多 3 次）、崩溃遗留的执行权 10 分钟后可被接管，不会再因为一次失败丢掉一整天。

签到结果只由签到接口本身判定，状态查询超时不会再把已成功的签到改写为失败；上游整体无响应属于瞬时故障，不会把账号标记为失败。菜单的健康行按 Cookie 有效性统计，定时签到未成功只单独提示，不再显示为账号失效。若 Cookie 是在手机或 Mac 上登录的，签到可能因设备不匹配（code 4）被拒，Bot 会按服务端返回的登录设备平台自动切换 UA 重试一次，并记住该账号可用的 UA。

本地验证：`npm test && node --check worker.js`。

## Workers 版部署

在 Cloudflare Dashboard 的 `glados-bot` 中配置 `BOT_TOKEN`、`ADMIN_ID` 和 `WEBHOOK_URL`。

| 变量 | 类型 | 值 |
|---|---|---|
| `BOT_TOKEN` | Secret | Telegram BotFather 的机器人 Token |
| `ADMIN_ID` | Secret 或 Text | 管理员的纯数字 Telegram 用户 ID |
| `WEBHOOK_URL` | Text | Worker 的固定完整 webhook 地址，例如 `https://你的域名/webhook` |

在 Cloudflare 修改 `BOT_TOKEN` 后无需再访问 `/setup`：部署生效后最多一小时（下一次整点 Cron 触发时），Bot 会用 `WEBHOOK_URL` 自动重新注册 webhook，并同步只保留 `/start` 命令。`ADMIN_ID` 修改随部署即时生效。根路径只返回运行状态，不会调用 Telegram API。

> ⚠️  `wrangler.toml` 的 `kv_namespaces` 里**不要写** `id` 字段：写了会绑死某个账号的命名空间，其他账号部署直接报 10041；不写则部署时自动创建并绑定。如需复用某个已有命名空间，再把它的 `id` 填回。

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

- **GLaDOS**：点「添加账号」→ 选择唯一的 GLaDOS 入口 → 直接发送完整 Cookie。Bot 会在多个互通域名中验证 Cookie、自动读取邮箱，并按邮箱更新已有账户；界面统一显示 GLaDOS，内部优先 `glados-facility.com`，再依次回退其他已支持域名。
Cookie 不要删减。手动指定邮箱可用 `邮箱|Cookie`，例如 `user@example.com|clk:xxxx=示例值; clk:xxxx.sig=示例签名`，每行一个账号；只按第一个 `|` 分隔，Cookie 中的冒号不参与解析。手动导入不限制 Cookie 名称，只检查邮箱及键值格式，不代表登录有效；有效性以实际账户查询为准。旧的 `邮箱:Cookie` 格式不再支持。

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
