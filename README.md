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
