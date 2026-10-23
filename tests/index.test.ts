import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

/** 隔离配置文件，避免污染真实的 ~/.pi/agent。必须在 import 扩展之前设置。 */
const configDir = mkdtempSync(join(tmpdir(), "pi-sticky-message-test-"));
const configPath = join(configDir, "sticky-message.json");
process.env.PI_STICKY_MESSAGE_CONFIG = configPath;

const { default: stickyMessage } = await import("../src/index.ts");
const { DEFAULT_CONFIG } = await import("../src/config.ts");

interface Notification {
	message: string;
	type?: string;
}

interface Harness {
	/** 触发 session_start，走一遍真实的安装路径。 */
	start(): Promise<void>;
	run(args: string, mode?: string): Promise<void>;
	notifications: Notification[];
	config(): unknown;
	renders(): number;
}

function makeHarness(): Harness {
	const notifications: Notification[] = [];
	let renders = 0;

	const tui = {
		mode: "fullscreen",
		terminal: { columns: 80, rows: 24 },
		overlayStack: [],
		requestRender() {
			renders += 1;
		},
		showOverlay() {
			return { hide() {} };
		},
		getMountedRoots: () => [],
	};

	const theme = {
		fg: (_token: string, text: string) => text,
		bg: (_token: string, text: string) => text,
		appearance: "dark",
		colors: { selectedBg: "#2a2e3a" },
		style: (text: string) => text,
	};

	const makeCtx = (mode: string) => ({
		mode,
		ui: {
			theme,
			setWidget(_key: string, content: unknown) {
				if (typeof content === "function") (content as (t: unknown, th: unknown) => unknown)(tui, theme);
			},
			notify(message: string, type?: "info" | "warning" | "error") {
				notifications.push({ message, type });
			},
		},
	});

	const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
	const events = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();

	stickyMessage({
		on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) {
			events.set(name, handler);
			return () => {};
		},
		registerCommand(name: string, definition: { handler: (args: string, ctx: unknown) => Promise<void> }) {
			commands.set(name, definition);
		},
	} as never);

	const command = commands.get("sticky-message");
	assert.ok(command, "注册了 /sticky-message 命令");

	return {
		async start() {
			const sessionStart = events.get("session_start");
			assert.ok(sessionStart, "注册了 session_start");
			await sessionStart({}, makeCtx("tui"));
		},
		run: (args: string, mode = "tui") => command.handler(args, makeCtx(mode)),
		notifications,
		config: () => JSON.parse(readFileSync(configPath, "utf8")),
		renders: () => renders,
	};
}

const resetConfigFile = () => rmSync(configPath, { force: true });

test("registers the lifecycle events it needs", async () => {
	const harness = makeHarness();
	// start() 会在缺少 session_start 时直接失败
	await harness.start();
});

test("toggle and on/off persist to the config file", async () => {
	resetConfigFile();
	const harness = makeHarness();

	await harness.run("");
	assert.deepEqual(harness.config(), { ...DEFAULT_CONFIG, enabled: false });

	await harness.run("on");
	assert.equal((harness.config() as { enabled: boolean }).enabled, true);

	await harness.run("off");
	assert.equal((harness.config() as { enabled: boolean }).enabled, false);

	await harness.run("off");
	assert.equal((harness.config() as { enabled: boolean }).enabled, false, "重复 off 保持关闭");
});

test("contrast, hint and pad validate their arguments", async () => {
	resetConfigFile();
	const harness = makeHarness();

	await harness.run("contrast 0.5");
	assert.equal((harness.config() as { contrast: number }).contrast, 0.5);

	await harness.run("contrast 2");
	assert.equal((harness.config() as { contrast: number }).contrast, 0.5, "越界不写入");
	assert.equal(harness.notifications.at(-1)?.type, "warning");

	await harness.run("contrast abc");
	assert.equal(harness.notifications.at(-1)?.type, "warning");

	await harness.run("hint off");
	assert.equal((harness.config() as { hint: boolean }).hint, false);

	await harness.run("hint maybe");
	assert.equal((harness.config() as { hint: boolean }).hint, false, "非法参数不写入");

	await harness.run("pad 3");
	assert.equal((harness.config() as { leftPad: number }).leftPad, 3);

	await harness.run("pad 99");
	assert.equal((harness.config() as { leftPad: number }).leftPad, 3);

	await harness.run("pad 1.5");
	assert.equal(harness.notifications.at(-1)?.type, "warning", "非整数被拒绝");
});

test("reset restores defaults", async () => {
	resetConfigFile();
	const harness = makeHarness();
	await harness.run("contrast 0.9");
	await harness.run("pad 4");
	await harness.run("reset");
	assert.deepEqual(harness.config(), DEFAULT_CONFIG);
});

test("configuration changes request a re-render", async () => {
	resetConfigFile();
	const harness = makeHarness();
	await harness.start();
	const before = harness.renders();
	await harness.run("contrast 0.4");
	assert.ok(harness.renders() > before, "改配置后重绘");
});

test("debug reports diagnostics and mentions the config and log paths", async () => {
	resetConfigFile();
	const harness = makeHarness();
	await harness.run("debug");
	const messages = harness.notifications.map((entry) => entry.message).join("\n");
	assert.match(messages, /sticky-message:/);
	assert.match(messages, /sticky-message-test/);
	assert.match(messages, /\.log/);
});

test("non-TUI modes are rejected without touching the config", async () => {
	resetConfigFile();
	const harness = makeHarness();
	await harness.run("on", "rpc");
	assert.equal(harness.notifications.at(-1)?.type, "warning");
	assert.throws(() => harness.config(), "RPC 模式下不应写配置");
});

test("a corrupt config file falls back to defaults", async () => {
	writeFileSync(configPath, "{ not json", "utf8");
	const { loadConfig } = await import("../src/config.ts");
	assert.deepEqual(loadConfig(configPath), DEFAULT_CONFIG);
	resetConfigFile();
});

test("a partial config file is normalized", async () => {
	writeFileSync(configPath, JSON.stringify({ contrast: 0.8, leftPad: 99 }), "utf8");
	const { loadConfig } = await import("../src/config.ts");
	assert.deepEqual(loadConfig(configPath), { ...DEFAULT_CONFIG, contrast: 0.8, leftPad: 8 });
	resetConfigFile();
});

test.after(() => {
	rmSync(configDir, { recursive: true, force: true });
});
