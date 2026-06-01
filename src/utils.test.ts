import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	rmSync,
	writeFileSync,
	accessSync,
	constants,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	applyPathFilters,
	currentPostBuildHook,
	excludeTemporaryPaths,
	getPostBuildHookPaths,
	postBuildHookFromText,
	postBuildHookScript,
	summarizeHookEvent,
	type HookEventRecord,
} from "./utils.ts";

// Run `printPostBuildHookCaptureLog` in a subprocess and capture its stdout.
//
// Why not just monkey-patch `process.stdout.write` in-process? Because
// `@actions/core` writes via the same stream that `node --test`'s reporter
// uses; patching it silently swallows other tests' reporter output and
// causes them to be dropped from the run. A subprocess keeps the two
// streams cleanly separated.
const runPrintInSubprocess = (env: Record<string, string | undefined>) => {
	const modulePath = new URL("./utils.ts", import.meta.url).pathname;
	const driver = `
		import("${modulePath}").then(m => m.printPostBuildHookCaptureLog())
			.then(() => process.exit(0))
			.catch(e => { console.error(e); process.exit(1); });
	`;
	const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
	for (const [k, v] of Object.entries(env)) {
		if (v === undefined) delete cleanEnv[k];
		else cleanEnv[k] = v;
	}
	return spawnSync(process.execPath, ["--input-type=module", "-e", driver], {
		env: cleanEnv,
		encoding: "utf8",
	});
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

describe("excludeTemporaryPaths", () => {
	test("drops .drv, .drv.chroot, .check, .lock", () => {
		const input = [
			"/nix/store/a",
			"/nix/store/b.drv",
			"/nix/store/c.drv.chroot",
			"/nix/store/d.check",
			"/nix/store/e.lock",
			"/nix/store/f",
		];
		assert.deepEqual(excludeTemporaryPaths(input), ["/nix/store/a", "/nix/store/f"]);
	});

	test("identity on clean inputs", () => {
		const input = ["/nix/store/a", "/nix/store/b", "/nix/store/c"];
		assert.deepEqual(excludeTemporaryPaths(input), input);
	});

	test("empty array → empty array", () => {
		assert.deepEqual(excludeTemporaryPaths([]), []);
	});
});

describe("applyPathFilters", () => {
	afterEach(() => restoreEnv());

	const paths = [
		"/nix/store/aaa-foo-1.0",
		"/nix/store/bbb-bar-2.0",
		"/nix/store/ccc-baz-3.0",
		"/nix/store/ddd-foo-4.0",
	];

	test("no inputs → identity", () => {
		setEnv("INPUT_INCLUDE-PATHS", undefined);
		setEnv("INPUT_EXCLUDE-PATHS", undefined);
		assert.deepEqual(applyPathFilters(paths), paths);
	});

	test("include-paths keeps only matching", () => {
		setEnv("INPUT_INCLUDE-PATHS", "foo");
		assert.deepEqual(applyPathFilters(paths), ["/nix/store/aaa-foo-1.0", "/nix/store/ddd-foo-4.0"]);
	});

	test("exclude-paths drops matching", () => {
		setEnv("INPUT_EXCLUDE-PATHS", "foo");
		assert.deepEqual(applyPathFilters(paths), ["/nix/store/bbb-bar-2.0", "/nix/store/ccc-baz-3.0"]);
	});

	test("include then exclude applied in order", () => {
		setEnv("INPUT_INCLUDE-PATHS", "foo\nbar");
		setEnv("INPUT_EXCLUDE-PATHS", "ddd");
		assert.deepEqual(applyPathFilters(paths), ["/nix/store/aaa-foo-1.0", "/nix/store/bbb-bar-2.0"]);
	});

	test("multiline include treated as OR", () => {
		setEnv("INPUT_INCLUDE-PATHS", "foo\nbaz");
		assert.deepEqual(applyPathFilters(paths), [
			"/nix/store/aaa-foo-1.0",
			"/nix/store/ccc-baz-3.0",
			"/nix/store/ddd-foo-4.0",
		]);
	});
});

describe("summarizeHookEvent", () => {
	test("full event renders all fields", () => {
		const event: HookEventRecord = {
			ts: "2026-05-31T13:00:00.000Z",
			pid: 12345,
			drvPath: "/nix/store/xxx.drv",
			rawOutPaths: "/nix/store/a /nix/store/b",
			paths: ["/nix/store/a", "/nix/store/b"],
			pathsFile: "/tmp/paths.abc",
			chained: { hook: "/orig.sh", status: 0 },
		};
		const out = summarizeHookEvent(event, 0);
		assert.match(out, /^#1 2026-05-31T13:00:00\.000Z pid=12345$/m);
		assert.match(out, /drv:\s+\/nix\/store\/xxx\.drv/);
		assert.match(out, /paths:\s+2 \(\/nix\/store\/a, \/nix\/store\/b\)/);
		assert.match(out, /file:\s+\/tmp\/paths\.abc/);
		assert.match(out, /chained:\s+\/orig\.sh \(status=0\)/);
	});

	test("skipped event renders reason", () => {
		const event: HookEventRecord = {
			ts: "2026-05-31T13:00:00.000Z",
			pid: 1,
			paths: [],
			skipped: { reason: "empty OUT_PATHS" },
		};
		assert.match(summarizeHookEvent(event, 5), /skipped:\s+empty OUT_PATHS/);
		assert.match(summarizeHookEvent(event, 5), /^#6/);
	});

	test("chained error renders", () => {
		const event: HookEventRecord = {
			ts: "x",
			pid: 1,
			paths: [],
			chained: { hook: "/orig", status: null, error: "boom" },
		};
		assert.match(summarizeHookEvent(event, 0), /chained:\s+\/orig \(status=n\/a, error=boom\)/);
	});

	test("error field renders", () => {
		const event: HookEventRecord = {
			ts: "x",
			pid: 1,
			paths: [],
			error: { message: "disk full" },
		};
		assert.match(summarizeHookEvent(event, 0), /error:\s+disk full/);
	});

	test("missing optional fields do not throw", () => {
		assert.doesNotThrow(() => summarizeHookEvent({}, 0));
	});
});

describe("printPostBuildHookCaptureLog", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "attic-utils-test-"));
	});

	afterEach(() => {
		restoreEnv();
		rmSync(root, { recursive: true, force: true });
	});

	const run = () =>
		runPrintInSubprocess({
			RUNNER_TEMP: root,
			ATTIC_POST_BUILD_EVENTS_LOG: join(root, "events.log"),
		});

	test("missing events.log → warning, no throw", () => {
		const result = run();
		assert.equal(result.status, 0, `stderr=${result.stderr}`);
		assert.match(result.stdout, /::warning::No hook invocations were captured/);
	});

	test("empty events.log → warning", () => {
		writeFileSync(join(root, "events.log"), "");
		const result = run();
		assert.equal(result.status, 0, `stderr=${result.stderr}`);
		assert.match(result.stdout, /::warning::No hook invocations were captured/);
	});

	test("multi-event log: summary totals correct", () => {
		const events = [
			{ ts: "t1", pid: 1, paths: ["/nix/store/a", "/nix/store/b"], pathsFile: "/tmp/p1" },
			{ ts: "t2", pid: 2, paths: ["/nix/store/c"], pathsFile: "/tmp/p2" },
			{ ts: "t3", pid: 3, paths: [], skipped: { reason: "empty OUT_PATHS" } },
		];
		writeFileSync(join(root, "events.log"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");

		const result = run();
		assert.equal(result.status, 0, `stderr=${result.stderr}`);
		assert.match(result.stdout, /Captured 3 hook invocation\(s\); 3 path\(s\) reported by Nix\./);
		assert.match(result.stdout, /#1 t1 pid=1/);
		assert.match(result.stdout, /#2 t2 pid=2/);
		assert.match(result.stdout, /#3 t3 pid=3/);
		assert.match(result.stdout, /skipped:\s+empty OUT_PATHS/);
	});

	test("malformed lines tolerated, warning emitted", () => {
		const log = [
			JSON.stringify({ ts: "t1", pid: 1, paths: ["/nix/store/a"] }),
			"not json at all",
			JSON.stringify({ ts: "t2", pid: 2, paths: [] }),
			"{ broken: ",
		].join("\n");
		writeFileSync(join(root, "events.log"), log + "\n");

		const result = run();
		assert.equal(result.status, 0, `stderr=${result.stderr}`);
		assert.match(result.stdout, /Captured 2 hook invocation\(s\); 1 path\(s\)/);
		assert.match(result.stdout, /::warning::Ignored 2 malformed event log line\(s\)/);
	});
});

describe("postBuildHookScript (wrapper shebang)", () => {
	test("has absolute shebang pointing at executable node", () => {
		const script = postBuildHookScript({
			pathsDir: "/x/paths",
			eventsLog: "/x/events.log",
			wrapper: "/x/wrapper.js",
			originalHook: "",
		});

		const firstLine = script.split("\n")[0]!;
		assert.match(firstLine, /^#!\//, "shebang must be absolute");

		const shebangPath = firstLine.slice(2).trim();
		assert.doesNotThrow(() => accessSync(shebangPath, constants.X_OK), `${shebangPath} not executable`);
	});

	test("embeds config as JSON in require call", () => {
		const config = {
			pathsDir: "/x/paths",
			eventsLog: "/x/events.log",
			wrapper: "/x/wrapper.js",
			originalHook: "/some/orig.sh",
		};
		const script = postBuildHookScript(config);
		// Extract and parse the JSON argument to runHook(...)
		const match = script.match(/runHook\((\{.+\})\);/s);
		assert.ok(match, "must contain runHook(...) call");
		const parsed = JSON.parse(match![1]!);
		assert.deepEqual(parsed, config);
	});

	test("shebang path tolerates spaces in config values (uses JSON.stringify)", () => {
		const script = postBuildHookScript({
			pathsDir: "/x/with spaces",
			eventsLog: "/x/with 'quotes'/events.log",
			wrapper: "/x/wrapper.js",
			originalHook: '/orig "weird".sh',
		});
		const match = script.match(/runHook\((\{.+\})\);/s);
		assert.ok(match);
		assert.deepEqual(JSON.parse(match![1]!).originalHook, '/orig "weird".sh');
	});
});

describe("postBuildHookFromText", () => {
	test("extracts post-build-hook from inline nix config", () => {
		const text = "experimental-features = nix-command flakes\npost-build-hook = /run/cachix/hook.sh\n";
		assert.equal(postBuildHookFromText(text), "/run/cachix/hook.sh");
	});

	test("strips surrounding double quotes", () => {
		assert.equal(postBuildHookFromText('post-build-hook = "/quoted/hook.sh"'), "/quoted/hook.sh");
	});

	test("returns undefined when not present", () => {
		assert.equal(postBuildHookFromText("experimental-features = flakes\n"), undefined);
		assert.equal(postBuildHookFromText(""), undefined);
	});

	test("last occurrence wins (matches Nix's behavior)", () => {
		const text = "post-build-hook = /first\npost-build-hook = /second\n";
		assert.equal(postBuildHookFromText(text), "/second");
	});
});

describe("currentPostBuildHook (discovery branches)", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "attic-discovery-test-"));
		// Clear all discovery-relevant env vars so each test starts from a
		// known baseline rather than picking up state from CI / dev machine.
		setEnv("CACHIX_DAEMON_DIR", undefined);
		setEnv("NIX_CONFIG", undefined);
		setEnv("NIX_USER_CONF_FILES", undefined);
	});

	afterEach(() => {
		restoreEnv();
		rmSync(root, { recursive: true, force: true });
	});

	test("finds hook via CACHIX_DAEMON_DIR when post-build-hook.sh exists", async () => {
		const hook = join(root, "post-build-hook.sh");
		writeFileSync(hook, "#!/bin/sh\n", { mode: 0o755 });
		setEnv("CACHIX_DAEMON_DIR", root);

		const result = await currentPostBuildHook();
		assert.deepEqual(result, { source: "CACHIX_DAEMON_DIR", hook });
	});

	test("ignores CACHIX_DAEMON_DIR when the expected file is absent", async () => {
		setEnv("CACHIX_DAEMON_DIR", root);
		assert.equal(await currentPostBuildHook(), undefined);
	});

	test("finds hook via NIX_CONFIG inline config (not NIX_CONF)", async () => {
		setEnv("NIX_CONFIG", "post-build-hook = /from/nix/config.sh");
		const result = await currentPostBuildHook();
		assert.deepEqual(result, { source: "NIX_CONFIG", hook: "/from/nix/config.sh" });
	});

	test("legacy NIX_CONF is intentionally not honored (Nix does not read it)", async () => {
		setEnv("NIX_CONF", "post-build-hook = /legacy/hook.sh");
		assert.equal(await currentPostBuildHook(), undefined);
	});

	test("finds hook via NIX_USER_CONF_FILES (first colon-separated file with a hook wins)", async () => {
		const confA = join(root, "a.conf");
		const confB = join(root, "b.conf");
		writeFileSync(confA, "experimental-features = flakes\n");
		writeFileSync(confB, "post-build-hook = /from/conf/b.sh\n");
		setEnv("NIX_USER_CONF_FILES", `${confA}:${confB}`);

		const result = await currentPostBuildHook();
		assert.deepEqual(result, { source: "NIX_USER_CONF_FILES", hook: "/from/conf/b.sh" });
	});

	test("CACHIX_DAEMON_DIR takes precedence over NIX_CONFIG", async () => {
		const hook = join(root, "post-build-hook.sh");
		writeFileSync(hook, "#!/bin/sh\n", { mode: 0o755 });
		setEnv("CACHIX_DAEMON_DIR", root);
		setEnv("NIX_CONFIG", "post-build-hook = /from/nix/config.sh");

		const result = await currentPostBuildHook();
		assert.equal(result?.source, "CACHIX_DAEMON_DIR");
	});

	test("returns undefined when no source provides a hook", async () => {
		assert.equal(await currentPostBuildHook(), undefined);
	});
});

describe("getPostBuildHookPaths (round-trip with hook output)", () => {
	let root: string;
	let pathsDir: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "attic-readback-test-"));
		pathsDir = join(root, "paths");
		mkdirSync(pathsDir, { recursive: true });
		// Point the state-lookup at our temp dir.
		setEnv("ATTIC_POST_BUILD_PATHS_DIR", pathsDir);
	});

	afterEach(() => {
		restoreEnv();
		rmSync(root, { recursive: true, force: true });
	});

	test("reads back paths written by the hook, sorted and de-duplicated", async () => {
		writeFileSync(join(pathsDir, "paths.aaa"), "/nix/store/zzz\n/nix/store/aaa\n");
		writeFileSync(join(pathsDir, "paths.bbb"), "/nix/store/mmm\n/nix/store/aaa\n");

		const paths = await getPostBuildHookPaths();
		assert.deepEqual(paths, ["/nix/store/aaa", "/nix/store/mmm", "/nix/store/zzz"]);
	});

	test("ignores non-paths.* files in the directory", async () => {
		writeFileSync(join(pathsDir, "paths.aaa"), "/nix/store/a\n");
		writeFileSync(join(pathsDir, "events.log"), '{"foo":1}\n');
		writeFileSync(join(pathsDir, "random.txt"), "/nix/store/should-not-appear\n");

		assert.deepEqual(await getPostBuildHookPaths(), ["/nix/store/a"]);
	});

	test("missing paths dir → empty array (no throw)", async () => {
		setEnv("ATTIC_POST_BUILD_PATHS_DIR", join(root, "does-not-exist"));
		assert.deepEqual(await getPostBuildHookPaths(), []);
	});

	test("empty paths.* files are tolerated", async () => {
		writeFileSync(join(pathsDir, "paths.empty"), "");
		writeFileSync(join(pathsDir, "paths.real"), "/nix/store/x\n");
		assert.deepEqual(await getPostBuildHookPaths(), ["/nix/store/x"]);
	});
});
