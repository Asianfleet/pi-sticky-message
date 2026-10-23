/**
 * pi 运行时内部结构访问层。
 *
 * 这里集中所有"没有公开 API、只能摸内部字段"的地方，pi 升级后失效时只需要改这个文件：
 *   - TuiAltScreen.getMountedRoots() → fullscreen 布局根 VStack（entries 里是 transcript + 输入区）
 *   - ScrollView.scrollTop / scrollTo / getContentWidth / children[0]（文档容器）
 *   - Stack.entries（运行时是公开字段，类型里是 protected）
 */

import type { Component, TUI } from "@earendil-works/pi-tui";

import { log } from "./log.ts";

/** transcript ScrollView 里我们用到的那部分能力。 */
export interface TranscriptLike extends Component {
	readonly scrollTop: number;
	readonly viewportHeight?: number;
	readonly primary?: boolean;
	scrollTo(top: number, options?: { disableFollow?: boolean }): void;
	getContentWidth(width: number): number;
	children: Component[];
}

/** fullscreen 布局根（VStack）里我们用到的那部分。 */
export interface StackRootLike {
	entries: {
		component: Component;
		basis?: number | "auto";
		grow?: number;
		shrink?: number;
		minSize?: number;
	}[];
	children: Component[];
}

export function describe(value: unknown): string {
	if (!value || typeof value !== "object") return String(value);
	const name = (value as object).constructor?.name ?? "Object";
	const children = (value as { children?: unknown[] }).children;
	return Array.isArray(children) ? `${name}(${children.length})` : name;
}

/** 取 TUI 挂载的布局根（fullscreen 下就是 chat viewport 的 VStack）。 */
export function mountedRoots(tui: TUI): Component[] {
	const internals = tui as unknown as {
		getMountedRoots?: () => Component[];
		children?: Component[];
	};
	return typeof internals.getMountedRoots === "function" ? internals.getMountedRoots() : (internals.children ?? []);
}

export function isTranscript(value: unknown): value is TranscriptLike {
	const candidate = value as Partial<TranscriptLike> | undefined;
	return (
		!!candidate &&
		typeof candidate.scrollTo === "function" &&
		typeof candidate.getContentWidth === "function" &&
		typeof candidate.scrollTop === "number" &&
		Array.isArray(candidate.children)
	);
}

/** 递归找 chat transcript：优先 primary ScrollView（chat viewport 创建时带 primary: true）。 */
export function findTranscript(tui: TUI): TranscriptLike | undefined {
	const found: TranscriptLike[] = [];
	const seen = new Set<unknown>();
	const walk = (node: unknown, depth: number) => {
		if (!node || typeof node !== "object" || depth > 5 || seen.has(node)) return;
		seen.add(node);
		if (isTranscript(node)) found.push(node);
		for (const child of (node as { children?: unknown[] }).children ?? []) walk(child, depth + 1);
	};
	for (const root of mountedRoots(tui)) walk(root, 0);

	if (found.length === 0) {
		log(`findTranscript: no ScrollView. roots=${mountedRoots(tui).map(describe).join(",")}`);
		return undefined;
	}
	return found.find((candidate) => candidate.primary === true) ?? found[0];
}

/** 找带 entries 数组的布局根。 */
export function findStackRoot(tui: TUI): StackRootLike | undefined {
	for (const root of mountedRoots(tui)) {
		const candidate = root as unknown as StackRootLike;
		if (Array.isArray(candidate.entries) && Array.isArray(candidate.children)) return candidate;
	}
	return undefined;
}

/**
 * 把组件作为第一行插进布局根，transcript 视口因此缩一行。
 *
 * `basis: "auto"` 表示按实际渲染行数占位：组件隐藏时渲染 0 行，就完全不占空间。
 * 用布局插行而不是 overlay，是因为 pi 只要存在可见 overlay 就会全局禁用滚动条拖动和
 * 文本选择（TuiBase.getScrollbarTargetAt / handleSelectionMouseEvent 都以 hasOverlay() 为前提）。
 */
export function attachToRoot(root: StackRootLike, component: Component): void {
	if (root.entries.some((entry) => entry.component === component)) return;
	root.entries.unshift({ component, basis: "auto", grow: 0, shrink: 0, minSize: 0 });
	if (!root.children.includes(component)) root.children.unshift(component);
	log("attached sticky row to layout root");
}

export function detachFromRoot(root: StackRootLike | undefined, component: Component): void {
	if (!root) return;
	const entryIndex = root.entries.findIndex((entry) => entry.component === component);
	if (entryIndex >= 0) root.entries.splice(entryIndex, 1);
	const childIndex = root.children.indexOf(component);
	if (childIndex >= 0) root.children.splice(childIndex, 1);
}
