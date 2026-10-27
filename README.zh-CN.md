# pi-sticky-message

[English](./README.md) | 简体中文

给 [Pi](https://pi.dev) 编码代理的全屏 transcript 加一条粘性单行标题：它始终显示你当前正在阅读的那条消息的首行，点击即可在消息之间跳转。

受 Codex 的 sticky message header 启发。做这个是因为在很长的 Pi 会话里往上滚之后，你完全不知道自己正在看的是哪个提问、哪段回答。

![transcript 顶部的粘性行](assets/preview.png)

这一行固定在 transcript 上方，显示你当前正在阅读的那条消息的首行。滚回最顶部时它会隐藏；点击跳转并停在某条消息开头时它也会隐藏。

这个插件不一样的地方：它追踪**每一条**消息——提问、回答、工具调用块都算——而不只是你最后输入的那句；而且它是真正的布局行，不是 overlay。没有任何东西画在 transcript 之上，视口只是少了一行；也没有 patch 任何 Pi 私有内部实现，所以滚动条拖动和文本选择天然可用，Pi 升级也不会让它失效。

## 安装

```bash
pi install npm:pi-sticky-message
```

只想临时试一次：

```bash
pi -e npm:pi-sticky-message
```

安装后重启 Pi，或执行 `/reload`。

## 使用

| 操作 | 效果 |
|---|---|
| 在 transcript 中向上滚动 | 顶部出现一行，显示视口顶部那条消息的首行 |
| 在该行上**左键点击** | 滚动到这条消息的开头；再点一次继续往前一条消息 |
| 在该行上**右键点击** | 跳到下一条消息 |
| 滚回最顶部 | 该行消失 |
| 点击后停在某条消息开头 | 停在那里时该行隐藏（文字已经就在眼前）；任何滚动都会让它重新出现 |

这一行是真实的布局行，**不是 overlay**：transcript 视口少一行，所以什么都不会被遮住，滚动条拖动、文本选择、滚轮滚动全都照常工作。

## 命令

```
/sticky-message                  开关切换
/sticky-message on | off         显式开关
/sticky-message contrast <0..1>  背景亮度（0 = 主题的 selectedBg，默认 0.25）
/sticky-message hint on | off    右侧那个淡淡的 ↑ 提示（默认开）
/sticky-message pad <0..8>       左侧缩进，用来和 transcript 文字对齐（默认 1）
/sticky-message reset            恢复默认
/sticky-message debug            打印诊断信息并显示一个静态测试 overlay
```

配置持久化到 `<agent-dir>/sticky-message.json`（通常是 `~/.pi/agent/sticky-message.json`），改完立即生效，无需重启。

### 与 `outputPad` 对齐

该行按 `pad` 列缩进（默认 `1`），以便和 transcript 文字对齐——Pi 用 `outputPad` 缩进正文（默认也是 `1`）。如果你在 `settings.json` 里改过 `outputPad`，把这里设成同一个值：

```bash
/sticky-message pad 0
```

## 前提与限制

- **仅全屏模式**（`"tuiMode": "fullscreen"`，也是默认值）。普通模式下滚动区由终端自己管理，没有视口可以挂这一行。
- 跳转目标是**消息边界**，与 Pi 自带的 `Ctrl+Shift+↑/↓` 使用的单位一致（每条用户消息、每条助手回复都算一条新的），不是每个工具调用。
- 扩展读取了 Pi 一些没有公开 API 的运行时内部结构（`TuiAltScreen.getMountedRoots()`、`ScrollView.scrollTop/scrollTo/children`、布局根的 `entries`）。Pi 升级可能让它失效，典型症状是该行默默不出现。这时跑 `/sticky-message debug`，并查看它指向的日志。
- 只有一行是刻意的：长消息会被省略号截断，不换行。

## 实现方式

1. 通过 `ctx.ui.setWidget()` 注册一个零高度组件，唯一目的是拿到当前的 `TUI` 实例。
2. 遍历已挂载的布局根，找到 `primary` 的那个 `ScrollView` 作为 transcript。
3. 消息边界来自 Pi 自己的 OSC 133 区域标记：把 transcript 文档渲染一次，每一行以 `\x1b]133;A` 开头的就是一条消息的开头。结果缓存 400ms，并按宽度失效。
4. 把这一行的组件 unshift 进布局根的 `entries`，于是它可见时 transcript 视口正好少一行，隐藏时一行不少（`basis: "auto"`）。

## 开发

```bash
npm install
npm run check     # tsc --noEmit + node --test
```

测试跑在 Node 原生 TypeScript 擦除上，没有构建步骤，也不发布任何编译产物——Pi 通过 jiti 直接加载 `src/index.ts`。

README 里的预览图由 [`assets/preview.html`](assets/preview.html) 生成：

```bash
chrome --headless=new --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1560,660 --screenshot=/tmp/shot.png assets/preview.html
magick /tmp/shot.png -fuzz 6% -trim +repage -bordercolor '#0f0f13' -border 40 \
  -resize 1800x assets/preview.png
```

## 许可证

MIT
