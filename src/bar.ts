/**
 * 顶部粘性消息条组件。
 *
 * 一行内容 = 当前视口所属那条消息的首行；左键点击在消息之间跳转。
 * 这一行是插在 fullscreen 布局根里的真实布局行（不是 overlay），所以：
 *   - 不遮挡正文，transcript 视口自动缩一行
 *   - 滚动条拖动、文本选择都不受影响
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	truncateToWidth,
	visibleWidth,
	type Color,
	type Component,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

import { brightenBackground } from "./colors.ts";
import type { StickyMessageConfig } from "./config.ts";
import { log } from "./log.ts";
import { jumpTarget, labelAt, measureDocument, MEASURE_TTL_MS, type Measurement } from "./measure.ts";
import { attachToRoot, describe, detachFromRoot, findStackRoot, findTranscript, type StackRootLike } from "./transcript.ts";

/** 右侧提示。 */
const HINT = "↑ ";

/** 空间不足时放弃提示的下限（可用宽度需大于 提示宽 + 这个值）。 */
const HINT_MIN_ROOM = 10;

export class StickyMessageBar implements Component {
	private cache: Measurement | undefined;
	/** 刚刚跳转到的位置；停在这里时不显示（文字已经就在眼前了）。 */
	private suppressedAt: number | undefined;
	private backgroundCache: { theme: Theme; contrast: number; color: Color } | undefined;
	private attachedRoot: StackRootLike | undefined;
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly getConfig: () => StickyMessageConfig;

	constructor(tui: TUI, theme: Theme, getConfig: () => StickyMessageConfig) {
		this.tui = tui;
		this.theme = theme;
		this.getConfig = getConfig;
	}

	invalidate(): void {
		this.cache = undefined;
		// 主题可能原地变了（/theme），重新算混色。
		this.backgroundCache = undefined;
	}

	/** 把这一行从布局根摘掉。 */
	detach(): void {
		detachFromRoot(this.attachedRoot, this);
		this.attachedRoot = undefined;
	}

	render(width: number): string[] {
		// 每帧跑一次：会话切换后布局根会被换掉，需要重新插进去。
		this.ensureAttached();

		const config = this.getConfig();
		if (!config.enabled) return [];

		const usableWidth = Math.max(1, Math.trunc(width));
		const transcript = findTranscript(this.tui);
		if (!transcript || transcript.scrollTop <= 0) return [];
		if (this.suppressedAt !== undefined && transcript.scrollTop === this.suppressedAt) return [];

		const measurement = this.measure(transcript, usableWidth);
		if (!measurement) return [];

		const label = labelAt(measurement, transcript.scrollTop);
		if (label === "") return [];

		return [this.styleLine(label, usableWidth, config)];
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "press") {
			// 认领按下，后续 release/click 才会派发给我们，而不是开始文本选择。
			if (event.button === "left" || event.button === "right") return { handled: true };
			return undefined;
		}
		if (event.type === "click") {
			if (event.button === "left") {
				this.jump(-1);
				return { handled: true, render: true };
			}
			if (event.button === "right") {
				this.jump(1);
				return { handled: true, render: true };
			}
		}
		// 滚轮不认领，继续交给 transcript 滚动。
		return undefined;
	}

	/** 诊断信息，供 `/sticky-message debug` 显示。 */
	diagnose(): string {
		// 顺手补一次插入，让诊断结果反映“现在能不能显示”，而不是“上一次渲染时”的状态。
		this.ensureAttached();
		const transcript = findTranscript(this.tui);
		if (!transcript) return "未找到 transcript ScrollView（看日志里的布局结构）";
		const measurement = this.measure(transcript, Math.max(1, this.tui.terminal.columns));
		const root = findStackRoot(this.tui);
		const attached = !!root && root.entries.some((entry) => entry.component === this);
		return [
			`scrollTop=${transcript.scrollTop}`,
			`viewport=${transcript.viewportHeight ?? "?"}`,
			`lines=${measurement?.total ?? "?"}`,
			`zones=${measurement?.zoneStarts.length ?? 0}`,
			`label=${JSON.stringify(measurement ? labelAt(measurement, transcript.scrollTop) : "")}`,
			`attached=${attached}`,
			`rootEntries=${root?.entries.length ?? "?"}`,
		].join(" ");
	}

	/** 保证自己在布局根的第一行；根换了就搬到新根。 */
	private ensureAttached(): void {
		const root = findStackRoot(this.tui);
		if (!root) {
			log(`ensureAttached: no layout root. roots=${describe(this.tui)}`);
			return;
		}
		if (this.attachedRoot !== root) {
			if (this.attachedRoot) detachFromRoot(this.attachedRoot, this);
			attachToRoot(root, this);
			this.attachedRoot = root;
			this.tui.requestRender();
			return;
		}
		if (!root.entries.some((entry) => entry.component === this)) {
			attachToRoot(root, this);
			this.tui.requestRender();
		}
	}

	private styleLine(label: string, width: number, config: StickyMessageConfig): string {
		const leftPadCount = Math.min(Math.max(0, config.leftPad), Math.max(0, width - 1));
		const available = Math.max(1, width - leftPadCount);
		const hintWidth = visibleWidth(HINT);
		const useHint = config.hint && available > hintWidth + HINT_MIN_ROOM;
		const labelWidth = useHint ? available - hintWidth : available;

		const text = truncateToWidth(label, labelWidth, "…");
		const textWidth = visibleWidth(text);
		const gap = " ".repeat(Math.max(0, available - textWidth - (useHint ? hintWidth : 0)));
		const used = leftPadCount + textWidth + gap.length + (useHint ? hintWidth : 0);

		const styled =
			" ".repeat(leftPadCount) +
			this.theme.fg("text", text) +
			gap +
			(useHint ? this.theme.fg("muted", HINT) : "") +
			" ".repeat(Math.max(0, width - used));

		const background = this.background(config.contrast);
		return background ? this.theme.style(styled, { bg: background }) : this.theme.bg("selectedBg", styled);
	}

	/** 比主题 selectedBg 更亮一档的背景色；取不到时返回 undefined，回退到 selectedBg。 */
	private background(contrast: number): Color | undefined {
		const cached = this.backgroundCache;
		if (cached && cached.theme === this.theme && cached.contrast === contrast) return cached.color;
		try {
			const color = brightenBackground(this.theme, contrast);
			this.backgroundCache = { theme: this.theme, contrast, color };
			return color;
		} catch (error) {
			log(`background mix failed: ${String(error)}`);
			return undefined;
		}
	}

	private jump(direction: 1 | -1): void {
		const transcript = findTranscript(this.tui);
		if (!transcript) return;
		const measurement = this.measure(transcript, Math.max(1, this.tui.terminal.columns));
		const zones = measurement?.zoneStarts ?? [];
		const top = transcript.scrollTop;
		const target = jumpTarget(zones, top, direction);

		if (target === undefined) {
			transcript.scrollTo(Math.max(0, top + direction * 10), { disableFollow: true });
			this.tui.requestRender();
			return;
		}

		log(`jump direction=${direction} from=${top} to=${target} zones=${zones.length}`);
		transcript.scrollTo(target, { disableFollow: true });
		// 已经停在那个位置了，再顶着一行重复的内容没意义：停在这里时隐藏。
		this.suppressedAt = transcript.scrollTop;
		this.tui.requestRender();
	}

	private measure(
		transcript: { children: Component[]; getContentWidth(width: number): number },
		width: number,
	): Measurement | undefined {
		const cached = this.cache;
		if (cached && cached.width === width && Date.now() - cached.at < MEASURE_TTL_MS) return cached;

		const document = transcript.children[0];
		if (!document) {
			log("measure: transcript has no document child");
			return undefined;
		}

		const measurement = measureDocument(document, transcript.getContentWidth(width), width);
		if (!measurement) {
			log("measure: document render threw");
			return undefined;
		}
		if (measurement.zoneStarts.length === 0) {
			log(`measure: no zones. lines=${measurement.total} document=${describe(document)}`);
		}
		this.cache = measurement;
		return measurement;
	}
}
