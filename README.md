# GLaDOS 签到 + Discourse 多站摸鱼 Bot ☁️

Telegram bot，自动签 GLaDOS，同时在 NodeLoc / NodeSeek / LinuxDO 假装人类刷阅读量升信任等级。

## 能干吗

- ✅ **GLaDOS 签到** — 多账号，每天自动，积分换天数
- ✅ **三站 Discourse 自动阅读** — 到点了就读几帖，不快不慢，还有随机休息
- ✅ **健康状态监控** — 菜单显示各站健康摘要：GLaDOS 签到成功数、Discourse 已读帖数、Cookie 失效自动标红、连续 5 次失败主动推告警到 Telegram
- ✅ **Telegram 管理** — 绑定账号、看统计数据、手动触发阅读，都在对话框搞定
- ✅ **行为模拟** — 每帖读 3-7 秒（手点）或 60-120 秒（cron），15% 概率休息 20-40 分钟，不触发风控

## 部署

### 一键部署（推荐）

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Linsars/glados-discourse-bot)

点按钮，授权 GitHub + Cloudflare，填 `BOT_TOKEN` 跟 `ADMIN_ID` 完事。

![GitHub Actions](https://github.com/Linsars/glados-discourse-bot/actions/workflows/deploy.yml/badge.svg)

### 手动部署

```
git clone https://github.com/Linsars/glados-discourse-bot.git
cd glados-discourse-bot
npm install -g wrangler
wrangler kv:namespace create GLADOS_DB
# 把 wrangler.toml 的 kv_namespaces.id 改成上面的 ID
# 在 Cloudflare Dashboard 加两个 secret:
#   BOT_TOKEN = 你的 TG Bot Token
#   ADMIN_ID = 你的 TG 用户 ID
wrangler deploy
```

### 激活

部署完访问 worker 域名（`https://xxx.workers.dev/`），自动配 webhook。

看到 `{"webhook":"✅ 已激活","commands":"✅ 已注册"}` 就行了。

### 自动部署（可选）

推 `worker.js` 到 `main` 分支自动部署到 Cloudflare Workers。

在仓库 Settings → Secrets and variables → Actions 设三个 Secret：

| Secret | 说明 |
|--------|------|
| `CF_API_TOKEN` | Cloudflare API Token（Worker 编辑权限） |
| `CF_ACCOUNT_ID` | 你的 Cloudflare 账号 ID |
| `KV_NS_ID` | KV Namespace ID（`GLADOS_DB` 绑定那个） |

设好后就不用再手动替代了，每次更新推上去就行。不设的话跳过，不影响一键按钮。

## 绑定账号

在 Telegram 里跟 bot 聊：

- **Discourse 论坛**：点「添加账号」→ 选站点 → 发 cookie（`_forum_session=xxx; _t=yyy`）
- **GLaDOS**：点「绑定账号」→ 发 cookie（`connect.sid=xxx`）

Bot 自动取邮箱和用户名，不用你费劲取名。

## 抓 Cookie（Surge / Loon / QX / Egern）

```
https://raw.githubusercontent.com/Linsars/Surge/main/sg/glados.yaml
```

Surge 模块，Egern 也兼容。装上后进各站点的「设置→账户」页面，模块自动捞 cookie。

### 手动也行

浏览器 F12 → Application → Cookies，找 `_forum_session` 和 `_t`，发给 bot。

## 各站升级条件

### NodeLoc

| 等级 | 门槛 | Bot 能跑 |
|------|------|---------|
| TL1 白银 | 600 分钟，100 帖 | ✅ |
| TL2 黄金 | 3000 分钟，30 天，赞/回复 | ✅ 阅读部分 |
| TL3 钻石 | 100 天，赞/回复 | ✅ 阅读部分 |
| TL4 王者 | 申请投票制 | ❌ |

### NodeSeek

| 等级 | 门槛 | Bot 能跑 |
|------|------|---------|
| TL1 基础 | 30 帖，10 分钟 | ✅ |
| TL2 成员 | 100 帖，60 分钟，15 天 | ✅ |
| TL3 常规 | 200 话题+500 帖，100 天 | ✅ |
| TL4 领袖 | 手动 | ❌ |

### LinuxDO

| 等级 | 门槛 | Bot 能跑 |
|------|------|---------|
| TL1 基础 | 10 分钟，15 帖 | ✅ |
| TL2 成员 | 300 分钟，80 帖，30 天 | ✅ |
| TL3 常规 | 2000 分钟，500 帖，100 天 | ✅ |
| TL4 领袖 | 手动隐藏关 | ❌ |

## 两套阅读模式

| 模式 | 触发时机 | 速度 | 怎么实现的 |
|------|---------|------|-----------|
| **手点直读** | 点 bot 按钮 | 3-7 秒/帖，跑 5 帖 | inline，latest.json → for 循环 → timing POST |
| **定时慢读** | 每小时 cron | 60-120 秒/帖，跑 5 帖 | `runNodelocBatch`，带队列和随机休息 |

手动走 webhook，`ctx.waitUntil()` 只有 30 秒窗口，所以必须快。cron 有 15 分钟，可以慢慢读。

## 加新 Discourse 站

加一行 `baseUrl`，把 `NS_BASE`、`LD_BASE` 替换成新站地址，再补一个 inline 手动读分支。

Discourse 核心接口三家一致（`latest.json`、`/t/{id}/timings`），但可能有 Cloudflare 等幺蛾子——遇到过再说。

## 环境变量

| 变量 | 干啥的 | 哪来的 |
|------|-------|-------|
| `BOT_TOKEN` | Telegram Bot Token | [@BotFather](https://t.me/BotFather) |
| `ADMIN_ID` | 你（管理员）的用户 ID | [@userinfobot](https://t.me/userinfobot) |
| `GLADOS_DB` | KV Namespace ID | `wrangler kv:namespace create` |

## License

MIT

爱改就改，反正我写完了。
