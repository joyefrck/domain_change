# Domain Entry

域名入口站监控增强版：一个自托管 Node 服务，用于维护候选登录域名池，并从用户浏览器真实检测当前网络下最适合进入的登录入口。

## 功能

- 公开入口页：并发检测候选域名的可选探测路径，显示推荐入口和手动备用列表。
- 管理后台：单管理员口令登录，支持域名新增、编辑、删除、启停、权重、标签和备注。
- SQLite 持久化：保存域名配置、匿名浏览器探测结果和审计日志。
- 健康端点：当前服务提供 `GET /healthz`。

## 启动

```bash
npm install
cp .env.example .env
# 编辑 .env，至少修改 ADMIN_PASSWORD 和 SESSION_SECRET
npm start
```

默认访问：

- 入口页：`http://localhost:3000/`
- 管理后台：`http://localhost:3000/admin/`

## 候选登录域名检测

每个候选登录域名可以提供轻量健康端点，例如：

```http
GET /healthz
Access-Control-Allow-Origin: https://your-entry-domain.example
Content-Type: application/json

{"ok":true}
```

入口页会从用户浏览器直接请求配置的探测路径。没有专用健康端点时，后台可以留空健康端点字段，入口页会检测该域名根路径 `/`；这种方式兼容性更好，但精确度可能低于专用健康端点。只有允许 CORS，入口页才能准确读取成功状态和延迟。

## 环境变量

- `HOST`：监听地址，默认 `0.0.0.0`。
- `PORT`：监听端口，默认 `3000`。
- `DATA_DIR`：SQLite 数据目录，默认 `./data`。
- `DB_PATH`：可选，直接指定 SQLite 文件路径。
- `ADMIN_PASSWORD`：后台管理员密码，生产环境必须配置。
- `SESSION_SECRET`：session cookie 签名密钥，生产环境必须配置。

## 验证

```bash
npm test
```

## 生产部署

当前生产服务器：

- 主机：`47.242.108.41`
- 应用目录：`/opt/domain-entry`
- systemd 服务：`domain-entry.service`
- Nginx 反代：`https://elephant-ipcheck.com` -> `http://127.0.0.1:3000`
- 线上运行配置：`/opt/domain-entry/.env`
- 线上 SQLite 数据：`/opt/domain-entry/data/`

注意：当前 `/opt/domain-entry` 不是 Git 仓库，不能直接在该目录执行 `git pull`。以后可以直接从 GitHub 拉取代码，但建议使用 release 目录部署：从 GitHub clone 新版本，安装依赖，通过健康检查后再切换目录。这样不会覆盖线上 `.env` 和 SQLite 数据，也保留旧版本目录用于回滚。

部署前先在本地确认并推送最新代码：

```bash
npm test
git status --short
git push origin main
```

在服务器上部署：

```bash
APP=/opt/domain-entry
REPO=https://github.com/joyefrck/domain_change.git
BRANCH=main
TS=$(date +%Y%m%d%H%M%S)
RELEASE=/opt/domain-entry.release-$TS
BACKUP=/opt/domain-entry.backup-$TS

git clone --depth 1 --branch "$BRANCH" "$REPO" "$RELEASE"
cp -a "$APP/.env" "$RELEASE/.env"
chmod 600 "$RELEASE/.env"

cd "$RELEASE"
npm ci --omit=dev

systemctl stop domain-entry.service
mv "$APP" "$BACKUP"
mv "$RELEASE" "$APP"
mv "$BACKUP/data" "$APP/data"
systemctl start domain-entry.service

systemctl is-active domain-entry.service
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS https://elephant-ipcheck.com/healthz
```

如果启动或健康检查失败，可以回滚到上一个备份目录：

```bash
systemctl stop domain-entry.service
mv /opt/domain-entry /opt/domain-entry.failed-$(date +%Y%m%d%H%M%S)
mv /opt/domain-entry.backup-YYYYMMDDHHMMSS /opt/domain-entry
systemctl start domain-entry.service
curl -fsS http://127.0.0.1:3000/healthz
```
