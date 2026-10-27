import assert from "node:assert/strict";
import test from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { StickyMessageBar } from "../src/bar.ts";
import { DEFAULT_CONFIG, type StickyMessageConfig } from "../src/config.ts";

/**
 * 这一组测试专门盯渲染层的两个坑（真实 ANSI，不是把转义当纯文本）：
 *   1. truncateToWidth 会在省略号附近插入 `\x1b[0m`，全量 reset 会把整行背景清掉，
 *      导致省略号、右侧提示、补白没有高亮。
 *   2. 行宽必须严格等于请求宽度，否则 pi 会硬切尾部，省略号就"消失"了。
 */

const BG = "\u001b[48;2;59;66;97m";
const FG = "\u001b[38;2;192;202;245m";

/** 真实转义序列的主题桩：只保留渲染层关心的一行背景 + 前景。 */
const theme = {
	appearance: "dark",
	colors: { selectedBg: "#3b4261" },
	getColorMode: () => "truecolor",
	fg: (_token: string, text: string) => `${FG}${text}\u001b[39m`,
	bg: (_token: string, text: string) => `${BG}${text}\u001b[49m`,
	style: (text: string) => text,
};

/** 逐字符记录"此刻背景是否开启"。 */
function cells(line: string): { ch: string; bg: boolean }[] {
	const result: { ch: string; bg: boolean }[] = [];
	let bg = false;
	let index = 0;
	while (index < line.length) {
		const csi = /^\u001b\[([0-9;]*)m/.exec(line.slice(index));
		if (csi) {
			const codes = csi[1]!
				.split(";")
				.filter((part) => part !== "")
				.map(Number);
			if (codes[0] === 48) bg = true;
			else if (codes[0] === 49 || codes[0] === 0) bg = false;
			index += csi[0].length;
			continue;
		}
		const char = String.fromCodePoint(line.codePointAt(index)!);
		result.push({ ch: char, bg });
		index += char.length;
	}
	return result;
}

function renderBarLines(lines: string[], width: number, overrides: Partial<StickyMessageConfig> = {}): string {
	const document = {
		render: () => lines.map((line, index) => (index === 0 ? `\u001b]133;A\u0007${line}` : line)),
		invalidate() {},
		children: [],
	};
	const transcript = {
		scrollTop: 3,
		viewportHeight: 10,
		primary: true,
		children: [document],
		getContentWidth: (value: number) => value,
		scrollTo() {},
		render: () => [],
		invalidate() {},
	};
	const root = { entries: [{ component: transcript, basis: 0 }], children: [transcript] };
	const tui = {
		getMountedRoots: () => [root],
		terminal: { columns: width, rows: 10 },
		mode: "fullscreen",
		requestRender() {},
	};
	const config: StickyMessageConfig = { ...DEFAULT_CONFIG, ...overrides };
	const bar = new StickyMessageBar(tui as never, theme as never, () => config);
	return bar.render(width)[0] ?? "";
}

function renderBar(label: string, width: number, overrides: Partial<StickyMessageConfig> = {}): string {
	return renderBarLines([label], width, overrides);
}

const LABELS = [
	"仓库已建好并推送：https://github.com/Asianfleet/pi-sticky-message (public, 带 topics)",
	"short",
	"a".repeat(200),
	"中文".repeat(60),
	"mixed 中文 and english 混排 with a long tail https://example.com/aaaaaaaaaaaaaaaaaaaa",
];

test("background covers every cell at every width", () => {
	for (const label of LABELS) {
		for (let width = 12; width <= 140; width += 1) {
			const line = renderBar(label, width);
			const parsed = cells(line);
			const uncovered = parsed.filter((cell) => !cell.bg);
			assert.equal(uncovered.length, 0, `w=${width} 有 ${uncovered.length} 列没有背景：${JSON.stringify(parsed.map((c) => c.ch).join("").slice(-16))}`);
		}
	}
});

test("the row is always exactly as wide as requested", () => {
	for (const label of LABELS) {
		for (let width = 12; width <= 140; width += 1) {
			const plain = cells(renderBar(label, width)).map((cell) => cell.ch).join("");
			assert.equal(visibleWidth(plain), width, `w=${width} label=${JSON.stringify(label.slice(0, 12))}`);
		}
	}
});

test("truncation always shows an ellipsis", () => {
	for (const label of LABELS) {
		for (let width = 12; width <= 140; width += 1) {
			const plain = cells(renderBar(label, width)).map((cell) => cell.ch).join("");
			if (visibleWidth(label) > width - 3) {
				assert.ok(plain.includes("…"), `w=${width} 截断却没有省略号：${JSON.stringify(plain)}`);
			}
		}
	}
});

test("no escape sequence leaks into the visible text", () => {
	for (const width of [20, 33, 56, 79, 120]) {
		const plain = cells(renderBar(LABELS[0]!, width)).map((cell) => cell.ch).join("");
		assert.ok(!plain.includes("\u001b"), `w=${width} 文本里残留转义`);
		assert.ok(!plain.includes("]133;"), `w=${width} 文本里残留 OSC 区域标记`);
	}
});

test("pad and hint configurations keep full coverage", () => {
	for (const overrides of [{ leftPad: 0 }, { leftPad: 4 }, { hint: false }, { leftPad: 3, hint: false }]) {
		for (let width = 12; width <= 120; width += 1) {
			const parsed = cells(renderBar(LABELS[0]!, width, overrides));
			assert.equal(parsed.filter((cell) => !cell.bg).length, 0, `config=${JSON.stringify(overrides)} w=${width}`);
			assert.equal(visibleWidth(parsed.map((cell) => cell.ch).join("")), width);
		}
	}
});

test("hint is dropped when there is no room for it", () => {	// 规则：available > 提示宽(2) + 10，leftPad=1 时宽度需 >= 14 才有提示
	const narrow = cells(renderBar(LABELS[0]!, 12)).map((cell) => cell.ch).join("");
	assert.ok(!narrow.includes("↑"), "窄宽度放弃提示");
	const fits = cells(renderBar(LABELS[0]!, 40)).map((cell) => cell.ch).join("");
	assert.ok(fits.includes("↑"), "宽度够时保留提示");
	const wide = cells(renderBar(LABELS[0]!, 120)).map((cell) => cell.ch).join("");
	assert.ok(wide.includes("↑"), "宽宽度保留提示");
});

test("a message whose first visual line fits still gets an ellipsis", () => {
	// 复现真实换行：transcript 按词换行，首行只有 8 列，后面还有两行。
	// 旧实现只把首个视觉行当标签，于是判定"塞得下"、不加省略号，看起来像被硬切。
	const lines = [
		"I should",
		"give you a much more detailed explanation of what is happening here,",
		"because the ellipsis keeps disappearing at certain widths.",
	];
	const joined = lines.join(" ");
	for (let width = 14; width <= 140; width += 1) {
		// 消息总宽真的塞不下时才要求省略号；塞得下就是完整显示，本来就不该有
		if (visibleWidth(joined) <= width - 3) continue;
		const plain = cells(renderBarLines(lines, width)).map((cell) => cell.ch).join("");
		assert.ok(plain.includes("…"), `w=${width} 消息还有后续内容却没有省略号：${JSON.stringify(plain)}`);
	}
});

test("a message that fits on one line keeps no ellipsis", () => {
	const plain = cells(renderBar("short", 60)).map((cell) => cell.ch).join("");
	assert.ok(!plain.includes("…"), "短消息不该出现省略号");
	assert.ok(plain.includes("short"));
});
