import assert from "node:assert/strict";
import test from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { brightenBackground, clamp01 } from "../src/colors.ts";
import { DEFAULT_CONFIG, normalizeConfig } from "../src/config.ts";
import { collectZones, jumpTarget, labelAt, lastIndexAtOrAbove, measureDocument } from "../src/measure.ts";
import { toPlainText, ZONE_START } from "../src/text.ts";

const ZONE = `${ZONE_START}\u0007`;

test("toPlainText strips OSC zone markers, CSI styling and control chars", () => {
	assert.equal(toPlainText(`${ZONE}第一条消息`), "第一条消息");
	assert.equal(toPlainText(`${ZONE}\u001b[1m加粗标题\u001b[22m`), "加粗标题");
	// 被截断的 OSC（没有 BEL 收尾）也不该把残留文字漏出来
	assert.equal(toPlainText(`\u001b]133;A\u001b[1m残留`), "残留");
	assert.equal(toPlainText("   缩进内容   "), "缩进内容");
	assert.equal(toPlainText(""), "");
});

test("collectZones finds message starts and their first non-empty line", () => {
	const lines = [
		"",
		"  pi v1.4.0 启动头",
		"",
		`${ZONE}第一条用户消息`,
		"  body",
		`${ZONE}`,
		"  第二条的首行在这一行",
		"  body",
	];
	const { zoneStarts, zoneLabels } = collectZones(lines);
	assert.deepEqual(zoneStarts, [3, 5]);
	// 第二条消息首行是空的区域标记行，应继续往下找到第一个非空行
	assert.deepEqual(zoneLabels, ["第一条用户消息", "第二条的首行在这一行"]);
});

test("collectZones returns empty result for a document without zones", () => {
	const { zoneStarts, zoneLabels } = collectZones(["a", "b"]);
	assert.deepEqual(zoneStarts, []);
	assert.deepEqual(zoneLabels, []);
});

test("lastIndexAtOrAbove handles boundaries", () => {
	const rows = [3, 8, 13];
	assert.equal(lastIndexAtOrAbove(rows, 0), -1);
	assert.equal(lastIndexAtOrAbove(rows, 2), -1);
	assert.equal(lastIndexAtOrAbove(rows, 3), 0);
	assert.equal(lastIndexAtOrAbove(rows, 7), 0);
	assert.equal(lastIndexAtOrAbove(rows, 8), 1);
	assert.equal(lastIndexAtOrAbove(rows, 99), 2);
	assert.equal(lastIndexAtOrAbove([], 5), -1);
});

test("labelAt picks the message containing the top visible row", () => {
	const measurement = {
		width: 40,
		at: 0,
		total: 20,
		zoneStarts: [3, 8, 13],
		zoneLabels: ["第一条", "第二条", "第三条"],
	};
	assert.equal(labelAt(measurement, 1), "", "header 区不显示");
	assert.equal(labelAt(measurement, 3), "第一条");
	assert.equal(labelAt(measurement, 7), "第一条");
	assert.equal(labelAt(measurement, 8), "第二条");
	assert.equal(labelAt(measurement, 19), "第三条");
});

test("jumpTarget walks between message starts", () => {
	const zones = [3, 8, 13];

	// 往下：跳到下一个消息起点，最后一个就停在原地
	assert.equal(jumpTarget(zones, 0, 1), 3);
	assert.equal(jumpTarget(zones, 3, 1), 8);
	assert.equal(jumpTarget(zones, 10, 1), 13);
	assert.equal(jumpTarget(zones, 13, 1), 13);

	// 往上：先对齐当前消息开头
	assert.equal(jumpTarget(zones, 10, -1), 8);
	assert.equal(jumpTarget(zones, 12, -1), 8);
	// 已对齐则退到上一条；第一条再往上回到绝对顶部
	assert.equal(jumpTarget(zones, 8, -1), 3);
	assert.equal(jumpTarget(zones, 3, -1), 0);
	// 落在 header 区时跳回第一条消息
	assert.equal(jumpTarget(zones, 1, -1), 3);

	// 没有任何消息时不跳
	assert.equal(jumpTarget([], 5, 1), undefined);
	assert.equal(jumpTarget([], 5, -1), undefined);
});

test("measureDocument survives a throwing document", () => {
	const broken = {
		render(): string[] {
			throw new Error("boom");
		},
		invalidate() {},
	};
	assert.equal(measureDocument(broken, 40, 40), undefined);
});

test("measureDocument records width, line count and zones", () => {
	const lines = [`${ZONE}标题`, "body", "body"];
	const document = {
		render: (width: number) => (width === 40 ? lines : []),
		invalidate() {},
	};
	const measurement = measureDocument(document, 40, 40);
	assert.ok(measurement);
	assert.equal(measurement.width, 40);
	assert.equal(measurement.total, 3);
	assert.deepEqual(measurement.zoneStarts, [0]);
	assert.deepEqual(measurement.zoneLabels, ["标题"]);
});

test("normalizeConfig clamps and falls back", () => {
	assert.deepEqual(normalizeConfig(undefined), DEFAULT_CONFIG);
	assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
	assert.deepEqual(normalizeConfig({ contrast: 5, leftPad: 99 }), { ...DEFAULT_CONFIG, contrast: 1, leftPad: 8 });
	assert.deepEqual(normalizeConfig({ contrast: -1, leftPad: -3 }), { ...DEFAULT_CONFIG, contrast: 0, leftPad: 0 });
	assert.deepEqual(normalizeConfig({ enabled: false, hint: false }), { ...DEFAULT_CONFIG, enabled: false, hint: false });
	// 非数字 / 非布尔的脏数据回落到默认值
	assert.deepEqual(normalizeConfig({ contrast: "0.5", leftPad: 1.7 }), { ...DEFAULT_CONFIG, leftPad: 1 });
	assert.deepEqual(normalizeConfig({ enabled: "yes" }), DEFAULT_CONFIG);
});

test("clamp01", () => {
	assert.equal(clamp01(0.5), 0.5);
	assert.equal(clamp01(-1), 0);
	assert.equal(clamp01(2), 1);
	assert.equal(clamp01(Number.NaN), 0);
});

test("brightenBackground is lighter than selectedBg on a dark theme", () => {
	const theme = {
		appearance: "dark",
		colors: { selectedBg: "#2a2e3a" },
	} as unknown as Parameters<typeof brightenBackground>[0];

	const bright = brightenBackground(theme, 0.25) as { l?: number };
	const base = brightenBackground(theme, 0) as { l?: number };
	assert.ok(typeof bright.l === "number" && typeof base.l === "number");
	assert.ok(bright.l! > base.l!, "混白之后应该更亮");
});

test("brightenBackground keeps the row readable by capping contrast at 1", () => {
	const theme = {
		appearance: "dark",
		colors: { selectedBg: "#2a2e3a" },
	} as unknown as Parameters<typeof brightenBackground>[0];
	// 超过 1 的 amount 会被 clamp，不抛错
	assert.doesNotThrow(() => brightenBackground(theme, 5));
});

test("visibleWidth sanity for the width math used by the bar", () => {
	assert.equal(visibleWidth("↑ 中文"), 6);
});
