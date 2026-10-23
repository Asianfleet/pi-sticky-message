/**
 * pi-sticky-message
 *
 * 在 fullscreen 模式的 transcript 顶部固定一行，显示"当前视口所属那条消息的首行"，
 * 左键点击在消息之间跳转（右键向下）。类似 Codex 的粘性消息头。
 *
 * 命令：
 *   /sticky-message                 开关
 *   /sticky-message on|off          显式开关
 *   /sticky-message contrast <0..1> 背景亮度（0 = 主题 selectedBg）
 *   /sticky-message hint on|off     右侧 ↑ 提示
 *   /sticky-message pad <0..8>      左侧缩进（与 pi 的 outputPad 对齐）
 *   /sticky-message debug           诊断信息 + 静态测试浮窗
 *   /sticky-message reset           恢复默认配置
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { StickyMessageBar } from "./bar.ts";
import { CONFIG_PATH, DEFAULT_CONFIG, loadConfig, saveConfig, type StickyMessageConfig } from "./config.ts";
import { log, LOG_PATH, resetLogBudget } from "./log.ts";
import { StaticProbe } from "./probe.ts";
import { findTranscript } from "./transcript.ts";

/** 只用来拿 TUI 引用的零高度 widget 键名。 */
const WIDGET_KEY = "sticky-message";

/** 零高度 widget：唯一作用是让工厂函数拿到 TUI 实例。 */
class TuiHandle {
	readonly tui: import("@earendil-works/pi-tui").TUI;

	constructor(tui: import("@earendil-works/pi-tui").TUI) {
		this.tui = tui;
	}

	render(): string[] {
		return [];
	}

	invalidate(): void {}
}

export default function (pi: ExtensionAPI) {
	let config: StickyMessageConfig = loadConfig();
	let bar: StickyMessageBar | undefined;
	let handle: TuiHandle | undefined;
	let probeHandle: { hide(): void } | undefined;

	log(`extension loaded. config=${JSON.stringify(config)}`);

	const teardown = () => {
		bar?.detach();
		bar = undefined;
		handle = undefined;
	};

	/** 挂载（幂等）。pi 会在不同时机重建 renderer，所以这里可能被多次调用。 */
	const install = (ctx: ExtensionContext, force = false) => {
		if (ctx.mode !== "tui") {
			log(`install skipped: mode=${ctx.mode}`);
			return;
		}
		if (!force && bar) return;
		try {
			ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
				teardown();
				const holder = new TuiHandle(tui);
				handle = holder;
				const mode = (tui as unknown as { mode?: string }).mode;
				log(`factory: tui mode=${mode}`);
				if (mode === "fullscreen") {
					bar = new StickyMessageBar(tui, theme, () => config);
					// 立刻尝试插入布局；布局根还没就绪时，bar.render 会在下一帧补上。
					bar.render(Math.max(1, tui.terminal.columns));
				}
				return holder;
			});
		} catch (error) {
			log(`install threw: ${String(error)}`);
		}
	};

	/** 事件名或处理器注册失败不能拖垮整个扩展。 */
	type EventHandler = (event: never, ctx: ExtensionContext) => Promise<void>;
	const registerEvent = pi.on.bind(pi) as unknown as (name: string, handler: EventHandler) => () => void;
	const safeOn = (name: string, handler: EventHandler) => {
		try {
			registerEvent(name, handler);
		} catch (error) {
			log(`register event ${name} failed: ${String(error)}`);
		}
	};

	safeOn("session_start", async (_event, ctx) => {
		config = loadConfig();
		install(ctx);
	});

	// renderer 可能在会话中途被重建；这些时机顺便补挂一次（install 是幂等的）。
	safeOn("agent_start", async (_event, ctx) => {
		install(ctx);
	});

	safeOn("turn_start", async (_event, ctx) => {
		install(ctx);
	});

	safeOn("session_shutdown", async () => {
		teardown();
		probeHandle?.hide();
		probeHandle = undefined;
	});

	const applyConfig = (next: StickyMessageConfig) => {
		config = next;
		saveConfig(config);
		handle?.tui.requestRender();
	};

	pi.registerCommand("sticky-message", {
		description: "顶部粘性消息条：显示当前消息并支持点击跳转",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const [verb, value] = trimmed.split(/\s+/);

			if (verb === "debug") {
				resetLogBudget();
				install(ctx, true);
				if (ctx.mode !== "tui") {
					ctx.ui.notify("sticky-message 需要交互式 TUI", "warning");
					return;
				}
				const summary = bar
					? bar.diagnose()
					: findTranscript(handle?.tui ?? ({} as never))
						? "找到 transcript 但 bar 未创建（可能不是 fullscreen 模式）"
						: "未找到 transcript，且 bar 未创建";
				log(`debug: ${summary}`);
				const target = handle?.tui;
				if (probeHandle) {
					probeHandle.hide();
					probeHandle = undefined;
				} else if (target) {
					probeHandle = target.showOverlay(
						new StaticProbe(ctx.ui.theme, " sticky-message 诊断：overlay 可渲染（会临时禁用滚动条拖动），再执行一次关闭 "),
						{ row: 0, col: 0, width: "100%", nonCapturing: true },
					);
				}
				ctx.ui.notify(`sticky-message: ${summary}`, "info");
				ctx.ui.notify(`配置：${CONFIG_PATH}`, "info");
				ctx.ui.notify(`日志：${LOG_PATH}`, "info");
				return;
			}

			if (ctx.mode !== "tui") {
				ctx.ui.notify("sticky-message 需要交互式 TUI", "warning");
				return;
			}

			if (verb === "on" || verb === "off") {
				applyConfig({ ...config, enabled: verb === "on" });
				ctx.ui.notify(`sticky-message ${verb === "on" ? "已开启" : "已关闭"}`, "info");
				return;
			}

			if (verb === "contrast") {
				const parsed = Number(value);
				if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
					ctx.ui.notify("用法：/sticky-message contrast <0..1>（0 = 主题选中背景色）", "warning");
					return;
				}
				applyConfig({ ...config, contrast: parsed });
				ctx.ui.notify(`sticky-message contrast = ${parsed}`, "info");
				return;
			}

			if (verb === "hint") {
				if (value !== "on" && value !== "off") {
					ctx.ui.notify("用法：/sticky-message hint on|off", "warning");
					return;
				}
				applyConfig({ ...config, hint: value === "on" });
				ctx.ui.notify(`sticky-message hint = ${value}`, "info");
				return;
			}

			if (verb === "pad") {
				const parsed = Number(value);
				if (!Number.isInteger(parsed) || parsed < 0 || parsed > 8) {
					ctx.ui.notify("用法：/sticky-message pad <0..8>", "warning");
					return;
				}
				applyConfig({ ...config, leftPad: parsed });
				ctx.ui.notify(`sticky-message pad = ${parsed}`, "info");
				return;
			}

			if (verb === "reset") {
				applyConfig({ ...DEFAULT_CONFIG });
				ctx.ui.notify("sticky-message 已恢复默认配置", "info");
				return;
			}

			// 无参数（或无法识别）：开关
			const enabled = !config.enabled;
			applyConfig({ ...config, enabled });
			ctx.ui.notify(`sticky-message ${enabled ? "已开启" : "已关闭"}`, "info");
		},
	});
}
