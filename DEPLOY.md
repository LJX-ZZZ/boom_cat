# 💣 炸弹猫 - 网页卡牌游戏

基于 Exploding Kittens 规则的网页卡牌游戏，支持 3-8 人游玩。

## 🎮 游玩

打开 `bomb-cat.html` 即可在浏览器中游玩（人机模式无需服务器）。

## 📡 部署指南

### 前端页面（人机模式）— GitHub Pages

1. 在 GitHub 创建一个新仓库（如 `bomb-cat`）
2. 把所有文件上传到仓库
3. 进入仓库 → Settings → Pages → Source 选 `main` 分支 → Save
4. 几分钟后访问 `https://你的用户名.github.io/bomb-cat/` 即可

### 联机服务器 — Railway（免费）

Railway 提供免费的 Node.js 托管，支持 WebSocket：

1. 打开 [railway.app](https://railway.app)，用 GitHub 登录
2. 点击 **New Project** → **Deploy from GitHub repo**
3. 选择你的 bomb-cat 仓库
4. Railway 会自动检测 `package.json` 并部署
5. 部署完成后，点击生成的域名（如 `xxx.railway.app`）
6. 记下 WebSocket 地址：`wss://xxx.up.railway.app`

### 联机使用方法

1. **房主**：在游戏菜单点击「创建房间」→ 输入服务器地址（如 `wss://xxx.up.railway.app`）→ 创建
2. **其他玩家**：点击「加入房间」→ 输入同样的服务器地址和房主给的6位房间码 → 加入

### 局域网联机（本地）

```bash
npm install
npm start
```

然后其他玩家在同一WiFi下访问 `http://你的IP:8080` 即可。

## 📁 文件说明

| 文件 | 说明 |
|------|------|
| `bomb-cat.html` | 游戏主页面（纯前端，所有代码都在这里） |
| `server.js` | 联机 WebSocket 服务器 |
| `package.json` | 依赖配置 |
| `index.html` | GitHub Pages 入口（自动跳转） |
