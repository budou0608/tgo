# TGO Widget MiniProgram AGENTS Guide

> 适用范围：`repos/tgo-widget-miniprogram`
> 最近校准：2026-03-10

## 1. 服务定位

`tgo-widget-miniprogram` 是访客侧嵌入式聊天组件，运行在 WeChat 小程序环境，负责消息展示、输入、IM 通道与小程序宿主交互。是 `tgo-widget-app`（React Web）的小程序原生版本。

- 技术栈：纯 JavaScript (ES5 兼容)、WeChat 小程序原生组件
- 构建产物：`miniprogram_dist/`，通过 `package.json` 的 `miniprogram` 字段发布为 npm 包
- 构建系统：`tools/build.js` (源文件复制 + babel 转编译 + zod .cjs 修复)
- 依赖库：`@json-render/core`, `zod`, `marked`, `easyjssdk`
- 姊妹项目：`tgo-widget-app`（React Web），两者的 json-render 组件需保持同步
- CI/CD：`miniprogram-ci` (example/ci.js 验证 npm 构建、编译、预览)

---

## 2. 关键目录与文件

```text
tgo-widget-miniprogram/
├── package.json                # 主包配置，miniprogram 字段指向 miniprogram_dist/
├── src/                        # 源代码
│   ├── chat/                   # 主组件 <tgo-chat>
│   ├── components/             # 子组件库
│   │   ├── message-list/       # 消息列表（滚动、历史加载）
│   │   ├── message-input/      # 输入框（文本输入、图片选择、发送/中断）
│   │   ├── message-bubble/     # 消息气泡（左/右侧样式）
│   │   ├── json-render-message/  # json-render 消息（文本+规格交替）
│   │   ├── json-render-surface/  # json-render 核心（状态存储、动作分派）
│   │   ├── json-render-element/  # json-render 单元素渲染（自递���）
│   │   ├── markdown-text/      # Markdown 渲染（使用 rich-text 组件）
│   │   └── system-message/     # 系统消息（客服接入/转接/结束）
│   ├── core/                   # 核心模块
│   │   ├── types.js            # 消息类型常量、payload 规范化
│   │   ├── chatStore.js        # 聊天状态管理（pub/sub 单例）
│   │   ├── platformStore.js    # 平台配置管理（主题、欢迎消息）
│   │   └── i18n.js             # 国际化（zh/en）
│   ├── services/               # API 服务层
│   │   ├── wukongim.js         # WuKongIM IM 服务（事件订阅、消息发送）
│   │   ├── chat.js             # 聊天完成、流取消 API
│   │   ├── visitor.js          # 访客注册、缓存
│   │   ├── messageHistory.js   # 历史消息同步
│   │   ├── upload.js           # 文件上传
│   │   └── platform.js         # 平台配置获取
│   ├── utils/                  # 工具函数
│   │   ├── jsonRender.js       # json-render 工具（Spec 构建、动作处理）
│   │   ├── markdown.js         # Markdown 转 HTML（marked）
│   │   ├── time.js             # 时间格式化（相对时间）
│   │   └── uid.js              # 唯一 ID 生成
│   └── adapters/               # 小程序 API 适配
│       ├── request.js          # wx.request Promise 包装
│       ├── storage.js          # wx.setStorageSync Promise 包装（支持 TTL）
│       └── systemInfo.js       # wx.getSystemInfoSync 包装
├── example/                    # 示例小程序（开发/测试用）
│   ├── project.config.json     # 小程序项目配置
│   ├── ci.js                   # miniprogram-ci 验证脚本
│   └── pages/                  # 示例页面
├── tools/
│   └── build.js                # 构建脚本：src → miniprogram_dist
└── miniprogram_dist/           # 构建产物（git ignore，npm 发布此目录）
```

---

## 3. 强约束规范

### 3.1 小程序组件模型

- 所有组件使用 `Component({})` 注册，遵循小程序生命周期 (`attached`、`detached`)
- 组件间通信：`properties` 数据绑定 + `bindXxx` 事件绑定
- 事件向上手动中继链：子组件 `triggerEvent('xxx', detail)` → 父组件 `bind:xxx="onXxx"` → 再向上
- **sendmessage 事件不使用 bubbles**，靠每层手动中继避免重复触发
- **action 事件使用 `bubbles: true, composed: true`**，穿过中间容器到达 surface
- 不使用 TypeScript，所有代码为纯 JavaScript (ES5 兼容)

### 3.2 构建与发布

- 源代码在 `src/`，构建产物在 `miniprogram_dist/`
- `tools/build.js` 负责：
  1. 复制 `src/` → `miniprogram_dist/`
  2. 同步到 `example/node_modules/tgo-widget-miniprogram/miniprogram_dist/`（替换 symlink）
  3. Babel 转编译 `@json-render/core`、`marked` 等 modern syntax
  4. 修复 `zod` .cjs 文件（.cjs → .js 且修正 require 路径），更新 `zod/package.json` 的 `main` 字段

### 3.3 状态管理

- 全局状态用 **pub/sub 单例**（`chatStore`、`platformStore`）
- 组件通过 `subscribe()` 订阅状态变化，`setData()` 同步 UI
- 消息流：IM 事件 → store state 变化 → 订阅者回调 → 组件 `setData()`

### 3.4 IM 通道与消息处理

- `wukongim.js` 是 EasyJSSDK 的 wrapper，负责连接、消息收发、自动重连
- 流式消息通过 `createMixedStreamParser()` 增量解析，`uiParts` 存储 DataPart 数组
- 历史消息加载时一次性调用 parser，结果与实时流式消息的渲染一致

---

## 4. 核心模块详解

### 4.1 chatStore.js

**关键方法**：
- `initIM(cfg)` — 初始化 IM（访客注册、token 获取、连接）
- `sendMessage(text)` — 发送文本消息（IM + 聊天完成 API）
- `uploadImage(tempFilePath)` — 上传图片
- `loadInitialHistory(limit)` / `loadMoreHistory(limit)` — 历史消息
- `cancelStreaming(reason)` — 取消流式传输
- `appendMixedPart(clientMsgNo, part)` — 追加混合流 DataPart
- `finalizeStreamMessage(clientMsgNo, errorMessage)` — 流式消息完成

**流式处理**：
- 每个 `clientMsgNo` 维护独立的 `MixedStreamParser` 实例
- Stream API v2 事件（`stream.delta`、`stream.close` 等）推动 parser 状态机
- `onText` 回调生成 text DataPart，`onPatch` 回调生成 data-spec DataPart

### 4.2 types.js

**消息类型**：TEXT=1, IMAGE=2, FILE=3, MIXED=12, COMMAND=99, AI_LOADING=100, 系统消息 1000-2000

**关键函数**：
- `toPayloadFromAny(raw)` — 规范化任意格式 payload
- `mapHistoryToChatMessage(m, myUid)` — API 历史消息转 ChatMessage（含 stream 事件解析）

---

## 5. json-render 系统

### 5.1 数据流

```
AI 输出 → ```spec 围栏内 JSONL 补丁
  → MixedStreamParser.onPatch()
  → DataPart { type: 'data-spec', data: { type: 'patch', patch } }
  → appendMixedPart() 追加到 uiParts
  → json-render-message 按文本/规格分组
  → json-render-surface 创建 state store
  → json-render-element 按类型递归渲染
```

### 5.2 三个核心组件

| 组件 | 职责 |
|------|------|
| `json-render-message` | 从 `uiParts` 分组（文本/规格交替），渲染 surface 或 markdown 回退 |
| `json-render-surface` | 接收 Spec，创建 state store，监听 action 事件，调用 root element |
| `json-render-element` | 单元素渲染，自递归处理 children，处理 input/checkbox/picker 交互 |

### 5.3 动作分派

- 内置 action（`setState`、`pushState` 等）自动处理
- 自定义 action 检测 `params.statePath`：有则更新本地状态，无则发送消息
- 消息格式：`[actionName]\nkey1: val1\nkey2: val2\n...state_keys...`

### 5.4 元素类型

- **布局**：Row, Column, Card, Section, ButtonGroup, Divider
- **文本**：Text (自动识别 KV、标题、金额)
- **交互**：Button, Input, Checkbox, MultipleChoice, DateTimeInput
- **展示**：Image, Badge, KV, PriceRow, OrderItem

---

## 6. 事件中继链

button 点击到最终发送消息的完整链路：

```
json-render-element (button)
  → triggerEvent('action', ..., { bubbles: true, composed: true })
  → 冒泡穿过 buttongroup / 容器
  → json-render-surface.onAction()
  → triggerEvent('sendmessage', { text })          // 无 bubbles
  → json-render-message.onSendMessage()
  → triggerEvent('sendmessage', e.detail)           // 无 bubbles
  → message-list.onJsonRenderSend()
  → triggerEvent('sendmessage', e.detail)           // 无 bubbles
  → tgo-chat.onSendMessage()
  → chatStore.sendMessage(text)
```

**关键**：`sendmessage` 事件不使用 `bubbles`，只靠手动中继，避免冒泡 + 中继叠加导致重复触发。

---

## 7. 高频改动入口

### 添加新消息类型
1. `types.js` — 定义常量，扩展 `toPayloadFromAny()`
2. `message-list/index.wxml` — 添加条件渲染分支

### 修改 json-render 元素
1. `json-render-element/index.wxml` — 添加 `wx:elif="{{elType === 'xxx'}}"`
2. `json-render-element/index.js` — 在 `_resolve()` 中添加数据提取
3. **确保与 tgo-widget-app 逻辑一致**

### 同步 tgo-widget-app bug fix
- 样式：React/Emotion → wxss
- 回调：React `onAction` → 小程序 `triggerEvent`
- Hooks → lifetimes / properties observer
- Context → pub/sub 单例

---

## 8. 构建与 CI

```bash
npm run build          # src → miniprogram_dist，同步到 example
npm run ci:pack-npm    # 验证 npm 构建（无需私钥）
npm run ci:compile     # 编译验证（需私钥，无需 IP 白名单）
npm run ci:preview     # 完整预览（需私钥 + IP 白名单）
```

私钥获取：微信公众平台 → 管理 → 开发管理 → 开发设置 → 小程序代码上传，放到 `example/private.wx.key`。

---

## 9. 常见 Gotcha

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| zod require 报错 | 小程序 npm builder 不识别 .cjs | build.js 自动 .cjs → .js + 修正 require |
| marked 解析失败 | ESM modern syntax | build.js Babel 转编译 |
| sendmessage 触发多次 | bubbles + 手动中继叠加 | sendmessage 不用 bubbles，只手动中继 |
| property type-uncompatible | 传入 null 给 String 属性 | 模板中用 `\|\|''` 兜底 |
| ScrollView 不滚动 | scroll-top 值未变化 | _scrollCounter 交替 999999/999998 |
| virtualHost 组件无 slot | 小程序限制 | 避免在 virtualHost 组件中使用 slot |
| 流式超时 | STREAM_TIMEOUT_MS=60000 | 超时后自动 markStreamingEnd() |
