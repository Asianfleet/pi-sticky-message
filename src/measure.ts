/**
 * 消息位置测量。
 *
 * 做法与 pi 自己的 `Ctrl+Shift+↑/↓`（TuiAltScreen.scrollToPrompt）一致：把 transcript 文档整体
 * 渲染一遍，扫 OSC 133 区域起始标记所在的行，就得到每条消息的起始行。
 *
 * 不遍历组件树的原因：`documentContainer` 只有少数几个顶层子组件（启动 header / chat 容器 /
 * 启动详情），消息全嵌在 chat 容器内部，按顶层子组件累加高度会完全测错。
 */

import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";

import { toPlainText, ZONE_START } from "./text.ts";

/** 测量结果缓存有效期（毫秒）。 */
export const MEASURE_TTL_MS = 400;

/**
 * 标签拼接预算：比条宽多一点。
 *
 * 拼到比条宽还宽就够截出省略号了，再多只是浪费；而预算必须**大于**条内可用宽度，
 * 否则可能刚好停在“还没超出”的位置，又退化成“首行塞得下就不显示省略号”。
 */
const LABEL_BUDGET_EXTRA = 8;

export interface Measurement {
	/** 测量时使用的宽度。 */
	width: number;
	/** 测量时间戳。 */
	at: number;
	/** 文档总行数。 */
	total: number;
	/** 每条消息起始行，升序。 */
	zoneStarts: number[];
	/** 每条消息的首个非空文本行。 */
	zoneLabels: string[];
}

/**
 * 从渲染好的文档行里扫出消息起始行与每条消息的标签文字。
 *
 * 标签不是“首个视觉行”而是“该消息的连续若干视觉行拼起来的一条”：transcript 正文按词换行，
 * 首个视觉行必然比宽度窄一个词的余数（0~10 列），只取它会出现“内容明明还有下一行、
 * 但这一行恰好塞得下所以不显示省略号”的假截断。拼接后只要消息真的还有内容，
 * 标签就一定超出可用宽度，省略号就一定会出现。
 *
 * `labelBudget` 限定拼接宽度，超出即停止（后面的文字本来也会被省略号截掉）。
 */
export function collectZones(
	lines: string[],
	labelBudget = Number.POSITIVE_INFINITY,
): { zoneStarts: number[]; zoneLabels: string[] } {
	const zoneStarts: number[] = [];
	for (let row = 0; row < lines.length; row += 1) {
		if ((lines[row] ?? "").startsWith(ZONE_START)) zoneStarts.push(row);
	}

	const zoneLabels: string[] = [];
	for (let index = 0; index < zoneStarts.length; index += 1) {
		const start = zoneStarts[index] ?? 0;
		const end = zoneStarts[index + 1] ?? lines.length;
		let label = "";
		for (let row = start; row < end; row += 1) {
			const text = toPlainText(lines[row] ?? "");
			if (!text) continue;
			label = label === "" ? text : `${label} ${text}`;
			if (visibleWidth(label) > labelBudget) break;
		}
		zoneLabels.push(label);
	}

	return { zoneStarts, zoneLabels };
}

/** 最后一个 <= value 的下标（rows 升序）。 */
export function lastIndexAtOrAbove(rows: number[], value: number): number {
	let low = 0;
	let high = rows.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if ((rows[middle] ?? Number.NEGATIVE_INFINITY) <= value) low = middle + 1;
		else high = middle;
	}
	return low - 1;
}

/** 当前滚动位置所属消息的首行；不在任何消息内（比如滚到启动 header 区）返回空串。 */
export function labelAt(measurement: Measurement, scrollTop: number): string {
	const index = lastIndexAtOrAbove(measurement.zoneStarts, scrollTop);
	if (index < 0) return "";
	return measurement.zoneLabels[index] ?? "";
}

/**
 * 计算跳转目标。
 *
 * direction = -1：对齐当前消息开头；已经对齐时跳到上一条；第一条再往上则回到绝对顶部。
 * direction = +1：下一条消息开头；已经是最后一条则停在最后一条。
 */
export function jumpTarget(zoneStarts: number[], scrollTop: number, direction: 1 | -1): number | undefined {
	if (zoneStarts.length === 0) return undefined;

	if (direction > 0) {
		const next = zoneStarts.find((row) => row > scrollTop);
		return next ?? zoneStarts[zoneStarts.length - 1] ?? scrollTop;
	}

	const index = lastIndexAtOrAbove(zoneStarts, scrollTop);
	if (index < 0) return zoneStarts[0] ?? 0;
	const current = zoneStarts[index] ?? 0;
	if (scrollTop > current) return current;
	return index > 0 ? (zoneStarts[index - 1] ?? 0) : 0;
}

/** 测量 transcript 文档；渲染失败或没有文档时返回 undefined。 */
export function measureDocument(
	document: Component,
	contentWidth: number,
	width: number,
): Measurement | undefined {
	let lines: string[];
	try {
		lines = document.render(Math.max(1, Math.trunc(contentWidth)));
	} catch {
		return undefined;
	}
	const { zoneStarts, zoneLabels } = collectZones(lines, width + LABEL_BUDGET_EXTRA);
	return { width, at: Date.now(), total: lines.length, zoneStarts, zoneLabels };
}
