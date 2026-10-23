/**
 * 配置：持久化在 pi 的 agent 目录下（`<agent-dir>/sticky-message.json`）。
 *
 * 改配置不需要重启：`/sticky-message contrast 0.4` 之类会写盘并立刻重绘。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { clamp01 } from "./colors.ts";
import { log } from "./log.ts";

export interface StickyMessageConfig {
	/** 是否启用（关掉后不占用任何行）。 */
	enabled: boolean;
	/** 背景亮度：0 = 主题 selectedBg，越大越亮。 */
	contrast: number;
	/** 是否在右侧显示淡淡的 ↑ 提示。 */
	hint: boolean;
	/** 左侧缩进，用来和 transcript 正文对齐（pi 的 outputPad 默认为 1）。 */
	leftPad: number;
}

export const DEFAULT_CONFIG: StickyMessageConfig = {
	enabled: true,
	contrast: 0.25,
	hint: true,
	leftPad: 1,
};

export const CONFIG_PATH = process.env.PI_STICKY_MESSAGE_CONFIG ?? join(getAgentDir(), "sticky-message.json");

const MIN_LEFT_PAD = 0;
const MAX_LEFT_PAD = 8;

export function normalizeConfig(raw: unknown): StickyMessageConfig {
	const source = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof StickyMessageConfig, unknown>>;
	const contrast = typeof source.contrast === "number" ? clamp01(source.contrast) : DEFAULT_CONFIG.contrast;
	const leftPad =
		typeof source.leftPad === "number" && Number.isFinite(source.leftPad)
			? Math.min(MAX_LEFT_PAD, Math.max(MIN_LEFT_PAD, Math.trunc(source.leftPad)))
			: DEFAULT_CONFIG.leftPad;
	return {
		enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_CONFIG.enabled,
		contrast,
		hint: typeof source.hint === "boolean" ? source.hint : DEFAULT_CONFIG.hint,
		leftPad,
	};
}

export function loadConfig(path: string = CONFIG_PATH): StickyMessageConfig {
	try {
		return normalizeConfig(JSON.parse(readFileSync(path, "utf8")));
	} catch (error) {
		// 文件不存在是正常情况（首次运行）；其他错误记一笔但不影响启动。
		if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") log(`loadConfig failed: ${String(error)}`);
		return { ...DEFAULT_CONFIG };
	}
}

export function saveConfig(config: StickyMessageConfig, path: string = CONFIG_PATH): boolean {
	try {
		writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
		return true;
	} catch (error) {
		log(`saveConfig failed: ${String(error)}`);
		return false;
	}
}
