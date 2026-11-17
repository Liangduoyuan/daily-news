# dsh-news-cloud

不依赖 DSH 的独立新闻推送服务：定时抓八家媒体的头条，生成**中英双语**简报，推到 Telegram / 企业微信群。电脑关机也照推。

**推荐跑法：GitHub Actions + Telegram Bot** —— 免服务器、免开机、免费（公开仓库不计分钟数）。

## 三种跑法对照

| 跑法 | 需要什么 | 关机也能推 | 即时触发 |
| --- | --- | --- | --- |
| **A. GitHub Actions + Telegram** | GitHub 账号 + Telegram bot | ✅ | ✅ 发「新闻」即可（最多 5 分钟延迟） |
| B. VPS / Docker + 企业微信 | 一台常开机器 | ✅ | ❌（除非自己加交互） |
| C. 本机手动 / DSH 插件 | 电脑开着 | ❌ | ✅ 点一下 |

---

# 方案 A：GitHub Actions + Telegram

## 1. 建一个 Telegram bot

1. Telegram 里搜 **@BotFather** → `/newbot`
2. 按提示起名 → 拿到一串 **token**，形如 `7891234567:AAH...`
3. 给你的新 bot 发一句话（必须发，否则它不能主动找你）

## 2. 拿到你的 chat id

最省事：给 **@userinfobot** 发任意消息，它回你的数字 id。

> 不要用「给 bot 发消息再调 getUpdates」这个办法：命令轮询工作流会每 5 分钟消费掉未确认消息，可能把你要查的那条确认掉。

## 3. 建仓库并推代码

```bash
# 在 cloud-news 目录里
git init -b main
git add .
git commit -m "daily bilingual news digest"
git remote add origin https://github.com/<你的用户名>/daily-news.git
git push -u origin main
```

仓库用 **public**：Actions 对公开仓库不计分钟数。密钥全部放 Secrets，不会进代码（`.gitignore` 已经挡掉 `.env`）。

## 4. 加三个 Secret

仓库 → **Settings → Secrets and variables → Actions → New repository secret**：

| Name | 值 |
| --- | --- |
| `NEWS_TELEGRAM_TOKEN` | 第 1 步的 bot token |
| `NEWS_TELEGRAM_CHAT_ID` | 第 2 步的数字 id |
| `NEWS_LLM_KEY` | DeepSeek API Key（<https://platform.deepseek.com/api_keys>） |

## 5. 先手动跑一次

**Actions → daily-news-digest → Run workflow**。绿勾后 Telegram 里应该收到一份完整简报。

成功后就不用管了，两条流水线自动运行：

| 工作流 | 触发 | 作用 |
| --- | --- | --- |
| `daily-news-digest` | 每天 `00:00` 和 `12:00` UTC（= 北京 08:00 / 20:00） | 推一份定时简报 |
| `daily-news-command` | 每 5 分钟 | 检查 Telegram，收到触发词就现生成一份回给你 |

## 6. 「发新闻就推送」

给 bot 发下面任意一个词：

```
新闻  新聞  news  日报  日報
```

流程会在下一次轮询时（≤5 分钟）生成一份**最新的**简报，回到你发消息的那个会话（私聊回私聊，群里回群）。

想更即时？`daily-news-command` 的 cron 可以从 `*/5` 改成 `*/2`（更费运行次数，公开仓库无所谓）。

## 注意事项

- **cron 是 UTC**，且 GitHub 的定时任务高峰期可能延迟几分钟到十几分钟，属正常现象。
- **定时任务只在默认分支上生效**，改完记得推到 `main`。
- **仓库连续 60 天没有任何提交活动，定时任务会被自动停用**，去 Actions 里点一下 Enable 即可。
- 公开仓库里**不要**把 token / key 写进代码或 workflow 文件，只能走 Secrets。
- GitHub 的 runner 在海外，访问 Google News 和 DeepSeek 都没问题。

---

# 方案 B：企业微信群机器人（VPS / Docker）

个人微信没有官方主动推送接口，群机器人 Webhook 是官方体系里唯一稳定的自推通道。

```bash
cp .env.example .env      # 填 NEWS_WECOM_WEBHOOK 和 NEWS_LLM_KEY

node test/local-e2e.mjs   # 不用 key 的自测
NEWS_DRY_RUN=1 node run.mjs   # 只生成不推送，先看内容
node run.mjs                  # 真推一次
```

常驻（带内置定时器与补发窗口）：

```bash
docker build -t dsh-news-cloud .
docker run -d --name news --restart unless-stopped --env-file .env -e TZ=Asia/Shanghai dsh-news-cloud
```

或者交给系统 cron（更省内存）：

```cron
0 8,20 * * * cd /opt/cloud-news && /usr/bin/node run.mjs >> /var/log/news.log 2>&1
```

---

# 网络位置的坑

**Google News 在中国大陆网络不可达。** GitHub runner 和海外 VPS 都没问题；必须部署在国内时，把 `src/sources.mjs` 里的 `googleNewsUrl` 换成各站自家 RSS（`src/rss.mjs` 是通用解析器，换 URL 即可），海外几家则要自备代理出口。

# 成本

每次运行输入约 2k tokens、输出约 1.5k tokens。按 DeepSeek 官方价格，一天几分钱。GitHub Actions 公开仓库免费。

# 本地自测（不需要任何 key）

```bash
node test/local-e2e.mjs     # 企业微信通道：18 项断言
node test/telegram-e2e.mjs  # Telegram 通道：11 项断言
```

两个都是假端点，不发真实消息。

# 目录结构

```
.
├── run.mjs                     一次性执行（cron / Actions 定时）
├── command.mjs                 轮询 Telegram，命中触发词就推送
├── daemon.mjs                  常驻模式（VPS / Docker 用）
├── src/
│   ├── config.mjs              环境变量 / .env
│   ├── rss.mjs                 RSS 解析（零依赖）
│   ├── sources.mjs             八家媒体 + Google News 查询 + 素材分组
│   ├── llm.mjs                 OpenAI 兼容 chat/completions
│   ├── digest.mjs              提示词与简报生成
│   ├── push.mjs                企业微信分段推送
│   ├── telegram.mjs            Telegram 发送与轮询
│   └── pipeline.mjs            采集 → 生成 → 推送
├── test/                       两个假端点自测
└── .github/workflows/          digest.yml + command.yml
```
