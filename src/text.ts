/**
 * 纯文本化：把一行带 ANSI / OSC 的渲染结果变成可以重新排版的字符串。
 */

import { stripTerminalSequences } from "@earendil-works/pi-tui";

/** pi 在每条消息首行写入的 OSC 133 区域起始标记（后接 BEL）。 */
export const ZONE_START = "\u001b]133;A";

/** OSC 序列（区域标记、超链接等）。stripTerminalSequences 只处理 CSI，OSC 要自己剥。 */
const OSC_SEQUENCE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/** 万一 OSC 被截断，清掉残留的区域标记文字。 */
const ZONE_RESIDUE = /\]133;[ABC]/g;

/** 控制字符（含残留的裸 ESC）。 */
const CONTROL = /[\u0000-\u001f\u007f]/g;

/**
 * 把一条渲染行变成可显示的纯文本。
 *
 * `stripTerminalSequences` 只认 CSI（`\x1b[...m`），而 pi 的消息区域标记是 OSC
 * （`\x1b]133;A\x07`），所以要先自己剥 OSC，再清控制字符，否则标签开头会带着
 * `\x1b` 和 `]133;A` 一起显示出来。
 */
export function toPlainText(line: string): string {
	return stripTerminalSequences(line.replace(OSC_SEQUENCE, ""))
		.replace(ZONE_RESIDUE, "")
		.replace(CONTROL, "")
		.trim();
}
