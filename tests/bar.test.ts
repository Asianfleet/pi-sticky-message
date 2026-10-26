import assert from "node:assert/strict";
import test from "node:test";

import { stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";

import { StickyMessageBar } from "../src/bar.ts";
import { DEFAULT_CONFIG, type StickyMessageConfig } from "../src/config.ts";
import { attachToRoot, detachFromRoot, findStackRoot, findTranscript, type StackRootLike } from "../src/transcript.ts";
import { ZONE_START } from "../src/text.ts";

const ZONE = `${ZONE_START}\u0007`;
const filler = (n: number) => Array.from({ length: n }, (_, i) => `  body ${i}`);

/** 造一份"启动 header + 三条消息"的文档，消息嵌在子容器里（真实结构就是这样）。 */
function makeWorld() {
	const lines = [
		"",
		"  pi v1.4.0",
		"",
		`${ZONE}第一条用户消息`,
		...filler(4),
		`${ZONE}第二条助手回复`,
		...filler(4),
		`${ZONE}一条特别长的消息标题，用来确认省略号真的加上了而不是被硬切掉，再多写一些字确保超宽`,
		...filler(20),
	];
	const zones = lines.map((line, index) => (line.startsWith(ZONE) ? index : -1)).filter((index) => index >= 0);

	const leaf = (text: string) => ({ render: () => [text], invalidate() {}, children: [] });
	const document = {
		children: [leaf(""), leaf("  pi v1.4.0"), { children: lines.slice(3).map(leaf) }],
		render: () => lines,
		invalidate() {},
	};

	const maxScroll = lines.length - 4;
	const transcript = {
		scrollTop: 0,
		viewportHeight: 4,
		primary: true,
		children: [document],
		getContentWidth: (width: number) => width,
		scrollTo(top: number) {
			this.scrollTop = Math.max(0, Math.min(maxScroll, top));
		},
		render: () => [],
		invalidate() {},
	};

	const dock = { children: [], render: () => [], invalidate() {} };
	const root: StackRootLike & { render: () => string[]; invalidate: () => void } = {
		entries: [
			{ component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{ component: dock, basis: "auto", grow: 0, shrink: 1 },
		],
		children: [transcript as never, dock as never],
		render: () => [],
		invalidate() {},
	};

	let overlayCalls = 0;
	const tui = {
		mode: "fullscreen",
		terminal: { columns: 40, rows: 20 },
		overlayStack: [],
		requestRender() {},
		showOverlay() {
			overlayCalls += 1;
			return { hide() {} };
		},
		getMountedRoots: () => [root],
	};

	const backgrounds: unknown[] = [];
	const theme = {
		fg: (_token: string, text: string) => text,
		bg: (_token: string, text: string) => text,
		appearance: "dark",
		colors: { selectedBg: "#2a2e3a" },
		style(text: string, options?: { bg?: unknown }) {
			if (options?.bg !== undefined) backgrounds.push(options.bg);
			return text;
		},
	};

	let config: StickyMessageConfig = { ...DEFAULT_CONFIG };
	const bar = new StickyMessageBar(tui as unknown as TUI, theme as never, () => config);
	const plain = (line: string) => stripTerminalSequences(line.replace(/\u001b\][^\u0007]*\u0007/g, ""));

	return {
		lines,
		zones,
		document,
		transcript,
		root,
		tui,
		theme,
		bar,
		plain,
		backgrounds,
		overlayCalls: () => overlayCalls,
		setConfig: (next: Partial<StickyMessageConfig>) => {
			config = { ...config, ...next };
		},
	};
}

test("the bar is a layout row, never an overlay (overlays disable scrollbar dragging)", () => {
	const world = makeWorld();
	world.transcript.scrollTop = world.zones[1]! + 2;
	world.bar.render(40);
	assert.equal(world.overlayCalls(), 0);
	assert.equal(world.root.entries[0]!.component, world.bar);
	assert.equal(world.root.children.includes(world.bar), true);
});

test("hidden states render zero lines so the viewport is not shrunk", () => {
	const world = makeWorld();

	world.transcript.scrollTop = 0;
	assert.deepEqual(world.bar.render(40), [], "顶部不显示");

	world.transcript.scrollTop = 1;
	assert.deepEqual(world.bar.render(40), [], "header 区不显示");

	world.setConfig({ enabled: false });
	world.transcript.scrollTop = world.zones[1]! + 2;
	assert.deepEqual(world.bar.render(40), [], "关闭后不显示");
});

test("renders the first line of the message at the top of the viewport", () => {
	const world = makeWorld();
	world.transcript.scrollTop = world.zones[1]! + 2;
	const lines = world.bar.render(40);
	assert.equal(lines.length, 1);
	const text = world.plain(lines[0]!);
	assert.equal(visibleWidth(text), 40, "整行铺满宽度");
	assert.equal(text[0], " ", "第 0 列留白");
	assert.ok(text.slice(1).startsWith("第二条助手回复"), "文字从第 1 列开始，与正文对齐");
	assert.ok(text.trimEnd().endsWith("↑"), "右侧提示");
});

test("long labels are ellipsized and narrow widths drop the hint", () => {
	const world = makeWorld();
	world.transcript.scrollTop = world.zones[2]!;
	const wide = world.plain(world.bar.render(40)[0]!);
	assert.ok(wide.includes("…"), "超长标签加省略号");
	assert.equal(visibleWidth(wide), 40);

	const narrow = world.plain(world.bar.render(12)[0]!);
	assert.equal(visibleWidth(narrow), 12);
	assert.ok(narrow.includes("…"));
	assert.ok(!narrow.includes("↑"), "窄宽度放弃提示，优先显示文字");
});

test("hint and leftPad are configurable", () => {
	const world = makeWorld();
	world.transcript.scrollTop = world.zones[1]! + 2;

	world.setConfig({ hint: false });
	const noHint = world.plain(world.bar.render(40)[0]!);
	assert.ok(!noHint.includes("↑"));
	assert.equal(visibleWidth(noHint), 40);

	world.setConfig({ hint: true, leftPad: 3 });
	const padded = world.plain(world.bar.render(40)[0]!);
	assert.equal(padded.slice(0, 3), "   ");
	assert.ok(padded.slice(3).startsWith("第二条助手回复"));
});

test("clicking jumps between messages and hides while parked there", () => {
	const world = makeWorld();
	const [first, second] = world.zones;

	world.transcript.scrollTop = second! + 2;
	assert.equal(world.bar.render(40).length, 1, "跳转前可见");

	world.bar.handleMouse({ type: "click", button: "left" } as never);
	assert.equal(world.transcript.scrollTop, second, "左键对齐到当前消息开头");
	assert.deepEqual(world.bar.render(40), [], "停在这里时隐藏");

	world.transcript.scrollTop = second! + 3;
	assert.equal(world.bar.render(40).length, 1, "一滚动就恢复");

	world.bar.handleMouse({ type: "click", button: "left" } as never);
	assert.equal(world.transcript.scrollTop, second, "再次对齐");
	world.bar.handleMouse({ type: "click", button: "left" } as never);
	assert.equal(world.transcript.scrollTop, first, "已对齐则跳到上一条");

	world.bar.handleMouse({ type: "click", button: "left" } as never);
	assert.equal(world.transcript.scrollTop, 0, "第一条再往上回到绝对顶部");

	world.transcript.scrollTop = first!;
	world.bar.handleMouse({ type: "click", button: "right" } as never);
	assert.equal(world.transcript.scrollTop, second, "右键跳到下一条");
});

test("press is claimed but wheel passes through to the transcript", () => {
	const world = makeWorld();
	world.transcript.scrollTop = world.zones[1]! + 2;
	assert.deepEqual(world.bar.handleMouse({ type: "press", button: "left" } as never), { handled: true });
	assert.equal(world.bar.handleMouse({ type: "wheel", button: "none" } as never), undefined);
});

test("follows a replaced layout root and reattaches after detach", () => {
	const world = makeWorld();

	const newDock = { children: [], render: () => [], invalidate() {} };
	const newRoot: StackRootLike & { render: () => string[]; invalidate: () => void } = {
		entries: [{ component: world.transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 }],
		children: [world.transcript as never, newDock as never],
		render: () => [],
		invalidate() {},
	};
	world.tui.getMountedRoots = () => [newRoot];

	world.transcript.scrollTop = world.zones[1]! + 2;
	world.bar.render(40);
	assert.equal(newRoot.entries[0]!.component, world.bar, "搬到新根");
	assert.equal(world.root.entries.some((entry) => entry.component === world.bar), false, "从旧根摘掉");

	world.bar.detach();
	assert.equal(newRoot.entries.some((entry) => entry.component === world.bar), false);
	assert.equal(newRoot.children.includes(world.bar), false);

	world.bar.render(40);
	assert.equal(newRoot.entries[0]!.component, world.bar, "下一帧自动插回");
});

test("background is a real colour escape that follows the contrast setting", () => {
	const world = makeWorld();
	world.transcript.scrollTop = world.zones[1]! + 2;

	// 真实背景色以 ANSI 序列出现在行首（theme 桩不做样式转换）
	const bgOf = (line: string) => /\[48;[25];[0-9;]+m/.exec(line)?.[0];
	const first = bgOf(world.bar.render(40)[0]!);
	assert.ok(first, "行首应有背景色序列");

	assert.equal(bgOf(world.bar.render(40)[0]!), first, "同 contrast 结果稳定");

	world.setConfig({ contrast: 0.6 });
	const brighter = bgOf(world.bar.render(40)[0]!);
	assert.ok(brighter, "改 contrast 后仍有背景色");
	assert.notEqual(brighter, first, "contrast 变了背景色应随之变化");
});

test("diagnose reports what the bar found", () => {
	const world = makeWorld();
	world.transcript.scrollTop = world.zones[1]! + 2;
	const summary = world.bar.diagnose();
	assert.match(summary, /attached=true/);
	assert.match(summary, /zones=3/);
	assert.match(summary, /label="第二条助手回复"/);
});

test("transcript helpers find the primary scroll view and the layout root", () => {
	const world = makeWorld();
	const tui = world.tui as unknown as TUI;
	assert.equal(findTranscript(tui), world.transcript);
	assert.equal(findStackRoot(tui), world.root as StackRootLike);
});

test("attachToRoot is idempotent and detachFromRoot removes both arrays", () => {
	const root: StackRootLike = {
		entries: [{ component: { render: () => [], invalidate() {} }, basis: 0 }],
		children: [{ render: () => [], invalidate() {} }],
	};
	const component = { render: () => [], invalidate() {} };

	attachToRoot(root, component);
	attachToRoot(root, component);
	assert.equal(root.entries.length, 2, "重复插入不会加两条");
	assert.equal(root.entries[0]!.component, component, "插在第一行");
	assert.equal(root.children.includes(component), true);

	detachFromRoot(root, component);
	assert.equal(root.entries.length, 1);
	assert.equal(root.children.includes(component), false);
});
