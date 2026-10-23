/**
 * 配色：从主题的选中背景色混出一档更亮（浅色主题则更暗）的背景。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { mixColors, parseColor, type Color } from "@earendil-works/pi-tui";

/** 主题配置里可能出现十六进制字符串，统一转成 Color 对象再参与混色。 */
export function asColor(value: Color | string): Color {
	return typeof value === "string" ? parseColor(value) : value;
}

/**
 * 把 `selectedBg` 往白色（暗色主题）或黑色（浅色主题）混 `amount`。
 *
 * 在 oklch 空间混色，避免 sRGB 直接混产生的发灰；`amount` 越大越亮（越有对比）。
 */
export function brightenBackground(theme: Theme, amount: number): Color {
	const base = asColor(theme.colors.selectedBg);
	const toward = asColor(theme.appearance === "light" ? "#000000" : "#ffffff");
	return mixColors(base, toward, clamp01(amount));
}

export function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}
