import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runHook, type HookConfig } from "./post-build-hook.ts";

type HookEvent = {
	ts: string;
	pid: number;
	drvPath: string | null;
	rawOutPaths: string;
	paths: string[];
	pathsFile: string | null;
	chained: { hook: string; status: number | null; error?: string } | null;
	skipped?: { reason: string; detail?: string };
	error?: { message: string; stack?: string };
};

const setup = () => {
	const root = mkdtempSync(join(tmpdir(), "attic-hook-test-"));
	const pathsDir = join(root, "paths");
	const eventsLog = join(root, "events.log");
	const wrapper = join(root, "wrapper.js");
	writeFileSync(eventsLog, "");
	const config: HookConfig = { pathsDir, eventsLog, wrapper, originalHook: "" };
	return { root, config };
};

const cleanup = (root: string) => {
	rmSync(root, { recursive: true, force: true });
};

const readEvents = (eventsLog: string): HookEvent[] =>
	readFileSync(eventsLog, "utf8")
		.split("\n")
		.filter((l) => l.trim() !== "")
		.map((l) => JSON.parse(l) as HookEvent);

const listPathsFiles = (pathsDir: string): string[] => {
	try {
		return readdirSync(pathsDir).filter((e) => e.startsWith("paths."));
	} catch {
		return [];
	}
};

// Track env mutations so we can clean up between tests.
let savedEnv: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string | undefined) => {
	if (!(k in savedEnv)) savedEnv[k] = process.env[k];
	if (v === undefined) delete process.env[k];
	else process.env[k] = v;
};
const restoreEnv = () => {
	for (const [k, v] of Object.entries(savedEnv)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	savedEnv = {};
};

describe("runHook", () => {
	let root: string;
	let config: HookConfig;

	beforeEach(() => {
		const s = setup();
		root = s.root;
		config = s.config;
	});

	afterEach(() => {
		restoreEnv();
		cleanup(root);
	});

	test("records all paths verbatim including .drv (no filtering in hook)", () => {
		setEnv("OUT_PATHS", "/nix/store/aaa-foo /nix/store/bbb.drv /nix/store/ccc-bar /nix/store/ddd.check");
		runHook(config);

		const events = readEvents(config.eventsLog);
		assert.equal(events.length, 1);
		assert.deepEqual(events[0]!.paths, [
			"/nix/store/aaa-foo",
			"/nix/store/bbb.drv",
			"/nix/store/ccc-bar",
			"/nix/store/ddd.check",
		]);

		const files = listPathsFiles(config.pathsDir);
		assert.equal(files.length, 1);
		const content = readFileSync(join(config.pathsDir, files[0]!), "utf8");
		assert.equal(content, "/nix/store/aaa-foo\n/nix/store/bbb.drv\n/nix/store/ccc-bar\n/nix/store/ddd.check\n");
	});

	test("writes a single valid JSONL line per invocation with required fields", () => {
		setEnv("OUT_PATHS", "/nix/store/x");
		setEnv("DRV_PATH", "/nix/store/x.drv");
		runHook(config);

		const raw = readFileSync(config.eventsLog, "utf8");
		assert.ok(raw.endsWith("\n"), "must end with newline");
		assert.equal(raw.split("\n").filter((l) => l.length > 0).length, 1);

		const event = readEvents(config.eventsLog)[0]!;
		assert.equal(typeof event.ts, "string");
		assert.match(event.ts, /^\d{4}-\d{2}-\d{2}T/);
		assert.equal(typeof event.pid, "number");
		assert.equal(event.drvPath, "/nix/store/x.drv");
		assert.equal(event.rawOutPaths, "/nix/store/x");
		assert.deepEqual(event.paths, ["/nix/store/x"]);
		assert.equal(typeof event.pathsFile, "string");
		assert.equal(event.chained, null);
	});

	test("generated paths.* file has mode 0o644", () => {
		setEnv("OUT_PATHS", "/nix/store/abc");
		runHook(config);
		const file = listPathsFiles(config.pathsDir)[0]!;
		const mode = statSync(join(config.pathsDir, file)).mode & 0o777;
		assert.equal(mode, 0o644);
	});

	test("pathsDir created with sticky world-writable bits (1777)", () => {
		setEnv("OUT_PATHS", "/nix/store/abc");
		runHook(config);
		const mode = statSync(config.pathsDir).mode & 0o7777;
		assert.equal(mode, 0o1777);
	});

	test("empty OUT_PATHS skips file creation and records skipped reason", () => {
		setEnv("OUT_PATHS", "");
		runHook(config);
		const event = readEvents(config.eventsLog)[0]!;
		assert.deepEqual(event.skipped, { reason: "empty OUT_PATHS" });
		assert.equal(event.pathsFile, null);
		assert.equal(listPathsFiles(config.pathsDir).length, 0);
	});

	test("missing OUT_PATHS env var behaves the same as empty", () => {
		setEnv("OUT_PATHS", undefined);
		runHook(config);
		const event = readEvents(config.eventsLog)[0]!;
		assert.equal(event.skipped?.reason, "empty OUT_PATHS");
		assert.equal(event.pathsFile, null);
	});

	test("DRV_PATH is captured when set, null otherwise", () => {
		setEnv("OUT_PATHS", "/nix/store/x");
		setEnv("DRV_PATH", undefined);
		runHook(config);
		assert.equal(readEvents(config.eventsLog)[0]!.drvPath, null);
	});

	test("multiple invocations append distinct events and files", () => {
		setEnv("OUT_PATHS", "/nix/store/first");
		runHook(config);
		setEnv("OUT_PATHS", "/nix/store/second");
		runHook(config);
		setEnv("OUT_PATHS", "/nix/store/third");
		runHook(config);

		const events = readEvents(config.eventsLog);
		assert.equal(events.length, 3);
		assert.deepEqual(
			events.map((e) => e.paths[0]),
			["/nix/store/first", "/nix/store/second", "/nix/store/third"],
		);

		const files = listPathsFiles(config.pathsDir);
		assert.equal(files.length, 3);
		assert.equal(new Set(files).size, 3, "filenames must be unique");
	});

	test("chains original hook, inheriting env, recording status 0", () => {
		const marker = join(root, "orig-marker");
		const orig = join(root, "orig.sh");
		writeFileSync(orig, `#!/usr/bin/env bash\necho "$OUT_PATHS" > ${JSON.stringify(marker)}\n`, {
			mode: 0o755,
		});
		chmodSync(orig, 0o755);
		config.originalHook = orig;

		setEnv("OUT_PATHS", "/nix/store/chained");
		runHook(config);

		assert.equal(readFileSync(marker, "utf8").trim(), "/nix/store/chained");
		const event = readEvents(config.eventsLog)[0]!;
		assert.equal(event.chained?.hook, orig);
		assert.equal(event.chained?.status, 0);
		assert.equal(event.chained?.error, undefined);
	});

	test("recursion guard: original==wrapper does not exec, records error", () => {
		config.originalHook = config.wrapper;
		setEnv("OUT_PATHS", "/nix/store/x");
		runHook(config);

		const event = readEvents(config.eventsLog)[0]!;
		assert.equal(event.chained?.hook, config.wrapper);
		assert.equal(event.chained?.status, null);
		assert.match(event.chained?.error ?? "", /recursion/);
	});

	test("missing original hook → chained.error populated, no throw", () => {
		config.originalHook = join(root, "does-not-exist");
		setEnv("OUT_PATHS", "/nix/store/x");
		assert.doesNotThrow(() => runHook(config));
		const event = readEvents(config.eventsLog)[0]!;
		assert.equal(event.chained?.status, null);
		assert.ok(event.chained?.error);
	});

	test("OUT_PATHS with mixed whitespace (tabs, spaces, newlines) splits correctly", () => {
		setEnv("OUT_PATHS", "  /nix/store/a\t/nix/store/b\n/nix/store/c  ");
		runHook(config);
		assert.deepEqual(readEvents(config.eventsLog)[0]!.paths, ["/nix/store/a", "/nix/store/b", "/nix/store/c"]);
	});

	test("event JSONL line stays small for typical inputs (reduces interleave window)", () => {
		// We do not actually guarantee atomicity for regular-file appends
		// (POSIX only guarantees this for pipes <= PIPE_BUF). Keeping lines
		// small just shrinks the window in which concurrent daemon writes
		// could interleave bytes. The post-step reader tolerates malformed
		// lines either way; this test guards against accidentally bloating
		// each event with large nested structures.
		setEnv("OUT_PATHS", Array.from({ length: 20 }, (_, i) => `/nix/store/p${i}`).join(" "));
		runHook(config);
		const line = readFileSync(config.eventsLog, "utf8");
		assert.ok(line.length < 4096, `expected < 4096 bytes, got ${line.length}`);
	});
});

describe("runHook (subprocess)", () => {
	let root: string;
	let config: HookConfig;

	beforeEach(() => {
		const s = setup();
		root = s.root;
		config = s.config;
	});

	afterEach(() => {
		cleanup(root);
	});

	const runInSubprocess = (env: Record<string, string>) => {
		const driver = join(root, "driver.ts");
		// Resolve hook module from this test file's directory at runtime.
		const hookModule = new URL("./post-build-hook.ts", import.meta.url).pathname;
		writeFileSync(
			driver,
			`import { runHook } from ${JSON.stringify(hookModule)};\nrunHook(${JSON.stringify(config)});\n`,
		);
		return spawnSync(process.execPath, [driver], {
			env: { ...process.env, ...env },
			encoding: "utf8",
		});
	};

	test("original hook non-zero exit propagates as process exit code", () => {
		const orig = join(root, "fail.sh");
		writeFileSync(orig, "#!/usr/bin/env bash\nexit 42\n", { mode: 0o755 });
		chmodSync(orig, 0o755);
		config.originalHook = orig;

		const result = runInSubprocess({ OUT_PATHS: "/nix/store/x" });
		assert.equal(result.status, 42, `stdout=${result.stdout}\nstderr=${result.stderr}`);

		const event = readEvents(config.eventsLog)[0]!;
		assert.equal(event.chained?.status, 42);
	});

	test("zero exit when no original hook", () => {
		const result = runInSubprocess({ OUT_PATHS: "/nix/store/x" });
		assert.equal(result.status, 0);
	});
});
