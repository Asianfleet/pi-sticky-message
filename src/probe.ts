/**
 * 诊断用的静态浮窗：验证 overlay 能否在第 0 行渲染出来。
 *
 * 注意：pi 只要存在可见 overlay 就会临时禁用滚动条拖动和文本选择，所以这个只用于排查，
 * 用完请再执行一次 `/sticky-message debug` 关掉。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

export class StaticProbe implements Component {
	private readonly theme: Theme;
	private readonly text: string;

	constructor(theme: Theme, text: string) {
		this.theme = theme;
		this.text = text;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const usableWidth = Math.max(1, Math.trunc(width));
		const plain = truncateToWidth(this.text, usableWidth, "…");
		const padding = " ".repeat(Math.max(0, usableWidth - visibleWidth(plain)));
		return [this.theme.bg("selectedBg", this.theme.fg("text", plain + padding))];
	}
}
