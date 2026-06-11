# QQChat — 即时聊天系统

基于 **Vue 3 + Vite** 前端和 **Express + WebSocket** 后端的实时即时通讯 Web 应用，支持多用户登录、一对一聊天、表情和图片发送。

---

## 功能特性

- **用户登录** — 输入 userId 即可登录，自动记住上次登录用户
- **联系人列表** — 显示在线/离线状态，默认预设联系人
- **实时消息** — 基于 WebSocket 的双向实时文字聊天
- **表情面板** — 内置 12 个常用 Emoji 表情
- **图片发送** — 支持本地图片上传与预览
- **消息历史** — 按会话维度存储在浏览器 localStorage 中
- **在线人数** — 实时显示当前在线用户数量
- **响应式布局** — 适配桌面端和移动端

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端框架 | Vue 3 (Composition API) | `<script setup>` 语法 |
| 构建工具 | Vite 5 | 开发服务器 + 生产构建 |
| 后端框架 | Express 4 | HTTP 服务器 |
| 实时通信 | ws 8 | WebSocket 协议 |
| 样式 | 原生 CSS | 无第三方 UI 库 |

---

## 项目结构

```
qqchat/
├── client/                    # 前端项目
│   ├── index.html             # HTML 入口
│   ├── package.json           # 依赖配置
│   ├── vite.config.js         # Vite 配置
│   ├── dist/                  # 生产构建产物
│   └── src/
│       ├── main.js            # Vue 应用入口
│       ├── App.vue            # 根组件（核心聊天界面）
│       └── style.css          # 全局样式
├── server/                    # 后端项目
│   ├── index.js               # Express + WebSocket 服务端
│   └── package.json           # 依赖配置
└── README.md
```

---

## 环境要求

- **Node.js** >= 18.x
- **npm** >= 9.x

---

## 快速开始

### 1. 安装依赖

```bash
# 安装服务端依赖
cd qqchat/server
npm install

# 安装客户端依赖
cd ../client
npm install
```

### 2. 启动服务端

```bash
cd qqchat/server
npm start
```

终端输出 `QQChat server listening on http://localhost:3000` 表示服务端启动成功。

### 3. 启动客户端

新开一个终端窗口：

```bash
cd qqchat/client
npm run dev
```

终端输出 `http://localhost:5173/` 表示前端启动成功。

### 4. 打开浏览器测试

1. 浏览器访问 `http://localhost:5173/`
2. 输入 `user1` 点击登录
3. 再打开一个**无痕窗口**，访问同一地址，输入 `user2` 登录
4. 在 user1 窗口左侧联系人列表选择 `user2`，发送消息
5. user2 窗口即可实时收到消息

> **提示：** 使用无痕窗口（或不同浏览器）可以避免两个窗口共享同一 localStorage 导致消息历史混乱。

---

## 使用指南

### 登录

在左侧边栏输入任意 userId（如 `user1`、`user2`、`user3`），点击登录按钮或按 Enter。

- 登录后会自动连接 WebSocket 服务器
- 登录信息会保存在 localStorage，下次打开自动填充
- 如果你登录的 userId 和当前选中的联系人相同，系统会自动切换到其他联系人

### 选择联系人

登录后左侧显示联系人列表，每个联系人显示在线状态（绿色 = 在线，灰色 = 离线）。点击联系人即可切换聊天对象，同时加载历史消息。

### 发送消息

- **文字消息**：在底部输入框输入内容，按 `Enter` 发送，`Shift + Enter` 换行
- **表情**：点击工具栏 😊 按钮打开表情面板，点击表情即可发送
- **图片**：点击工具栏 🖼 按钮选择本地图片文件

### 消息气泡

- 自己发送的消息显示为**蓝色气泡**，靠右对齐
- 对方发送的消息显示为**白色气泡**，靠左对齐
- 每条消息下方显示发送时间

---

## 通信架构

```
┌──────────────┐         WebSocket          ┌──────────────┐
│   Browser A  │ ◄─────────────────────────► │              │
│  (user1)     │    ws://localhost:3000      │   Express    │
└──────────────┘                             │   + WS       │
                                             │   Server     │
┌──────────────┐         WebSocket          │   :3000      │
│   Browser B  │ ◄─────────────────────────► │              │
│  (user2)     │    ws://localhost:3000      │              │
└──────────────┘                             └──────────────┘
```

### 数据流程

1. **连接** — 客户端通过 `ws://localhost:3000?userId=xxx` 连接 WebSocket 服务器
2. **在线广播** — 用户连接/断开时，服务器向所有在线用户广播最新在线列表
3. **消息转发** — 用户 A 发送消息 → 服务器查找目标用户 B 的 WebSocket → 转发给 B
4. **本地存储** — 发送和接收的消息均保存到浏览器 localStorage，按会话维度组织

### WebSocket 消息协议

| type | 方向 | 说明 | 数据结构 |
|------|------|------|----------|
| `message` | 客户端 → 服务端 | 发送聊天消息 | `{ type: "message", message: {...} }` |
| `message` | 服务端 → 客户端 | 接收聊天消息 | `{ type: "message", message: {...} }` |
| `onlineUsers` | 服务端 → 客户端 | 在线用户列表 | `{ type: "onlineUsers", users: [...] }` |

### Message 对象结构

```json
{
  "id": "1718123456789-a1b2c3",
  "from": "user1",
  "to": "user2",
  "type": "text | emoji | image",
  "content": "消息内容",
  "timestamp": 1718123456789
}
```

---

## 可用脚本

### 客户端

```bash
npm run dev       # 启动 Vite 开发服务器（热更新）
npm run build     # 构建生产版本到 dist/
npm run preview   # 预览生产构建
```

### 服务端

```bash
npm start         # 启动 Express + WebSocket 服务器
```

---

## 待完善功能

以下功能可在后续迭代中实现：

- [ ] **数据库持久化** — 使用 MongoDB/MySQL 替代内存存储和 localStorage
- [ ] **用户注册与认证** — 增加密码登录、Token 鉴权
- [ ] **群聊功能** — 支持多人同时聊天
- [ ] **消息已读状态** — 发送已读回执
- [ ] **输入状态提示** — "对方正在输入…"
- [ ] **消息通知** — 新消息声音/桌面通知
- [ ] **文件传输** — 支持文件类型消息
- [ ] **消息搜索** — 聊天记录搜索
- [ ] **用户头像** — 支持自定义头像上传
- [ ] **单元测试** — 前后端测试覆盖
- [ ] **Docker 部署** — 容器化部署方案

---

## License

MIT
