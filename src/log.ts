/**
 * 诊断日志。
 *
 * 依赖的是 pi 的运行时内部结构，出问题时最有效的排查手段就是看这里记录了哪一步失败。
 * 文件位置：系统临时目录下的 pi-sticky-message.log（路径会随通知一起打印出来）。
 */

import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const LOG_PATH = join(tmpdir(), "pi-sticky-message.log");

/** 单次进程内的写入预算，避免日志被渲染循环刷爆。 */
const LOG_BUDGET = 600;

let budget = LOG_BUDGET;

export function log(message: string): void {
	if (budget <= 0) return;
	budget -= 1;
	try {
		appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`);
	} catch {
		// 日志失败不影响主流程
	}
}

/** 让 /sticky-message debug 之后的排查能拿到新日志。 */
export function resetLogBudget(): void {
	budget = LOG_BUDGET;
}
