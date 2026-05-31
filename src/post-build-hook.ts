// This file is bundled separately as `dist/post-build-hook.js` and invoked
// by the nix-daemon (typically as root) for every built derivation. It must
// not import `@actions/*` packages, since it runs outside of the GitHub
// Actions runtime.
//
// Configuration is provided by a tiny generated shim that requires this
// bundle and calls `runHook` with absolute paths baked in. We avoid
// environment variables because the nix-daemon strips/normalizes them.

import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

export type HookConfig = {
	pathsDir: string;
	eventsLog: string;
	wrapper: string;
	originalHook: string;
};

// One JSON object per invocation, one line per object. Designed to be
// `jq`-friendly when read back in the post step and to survive interleaving
// from concurrent daemon-spawned hook processes (a single `appendFileSync`
// of a line < PIPE_BUF is atomic on Linux).
//
// The hook intentionally records every path Nix reports verbatim; all
// filtering (temporary paths, include/exclude regexes) happens in the post
// step so there is one source of truth and the capture log honestly reflects
// what the daemon told us.
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

const splitOutPaths = (raw: string) => raw.split(/\s+/).filter((p) => p !== "");

const writeEvent = (config: HookConfig, event: HookEvent) => {
	// Single write of `JSON\n`; on Linux writes <= PIPE_BUF (4096) to a file
	// opened in append mode are atomic, so concurrent hook invocations won't
	// interleave lines.
	try {
		appendFileSync(config.eventsLog, JSON.stringify(event) + "\n");
	} catch (error) {
		process.stderr.write(
			`attic-action post-build hook: failed to write event log: ${(error as Error).message}\n`,
		);
	}
};

const recordOutPaths = (config: HookConfig, event: HookEvent): void => {
	const raw = event.rawOutPaths;
	if (raw.trim() === "") {
		event.skipped = { reason: "empty OUT_PATHS" };
		return;
	}

	mkdirSync(config.pathsDir, { recursive: true, mode: 0o1777 });
	// Counter the daemon's potentially restrictive umask so that the runner
	// user can read these files back in the post step.
	try {
		chmodSync(config.pathsDir, 0o1777);
	} catch {
		// Best-effort; if we can't chmod we still try to write readable files.
	}

	const all = splitOutPaths(raw);
	event.paths = all;

	if (all.length === 0) {
		event.skipped = { reason: "no paths in OUT_PATHS" };
		return;
	}

	const tmp = join(config.pathsDir, `paths.${randomBytes(6).toString("hex")}`);
	writeFileSync(tmp, all.join("\n") + "\n", { mode: 0o644 });
	// Explicit chmod in case `mode` was masked by the daemon's umask.
	chmodSync(tmp, 0o644);
	event.pathsFile = tmp;
};

const chainOriginalHook = (config: HookConfig, event: HookEvent): void => {
	if (!config.originalHook) return;

	if (config.originalHook === config.wrapper) {
		event.chained = {
			hook: config.originalHook,
			status: null,
			error: "original hook points to this wrapper; skipping to avoid recursion",
		};
		return;
	}

	const result = spawnSync(config.originalHook, process.argv.slice(2), {
		stdio: "inherit",
		env: process.env,
	});

	if (result.error) {
		event.chained = { hook: config.originalHook, status: null, error: result.error.message };
		return;
	}

	event.chained = { hook: config.originalHook, status: result.status };
};

export const runHook = (config: HookConfig) => {
	process.umask(0o022);

	const event: HookEvent = {
		ts: new Date().toISOString(),
		pid: process.pid,
		drvPath: process.env["DRV_PATH"] ?? null,
		rawOutPaths: process.env["OUT_PATHS"] ?? "",
		paths: [],
		pathsFile: null,
		chained: null,
	};

	try {
		recordOutPaths(config, event);
	} catch (error) {
		event.error = {
			message: (error as Error).message,
			stack: (error as Error).stack,
		};
	}

	chainOriginalHook(config, event);
	writeEvent(config, event);

	if (event.chained && typeof event.chained.status === "number" && event.chained.status !== 0) {
		process.exit(event.chained.status);
	}
};
