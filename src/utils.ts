import * as core from "@actions/core";
import { exec } from "@actions/exec";

import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const INTERNAL_DRY_RUN = ["true", "1", "yes"].includes(
	core.getInput("__internal-dry-run", { required: false, trimWhitespace: true }),
);

export const PATH_DISCOVERY_STORE_SCAN = "store-scan";
export const PATH_DISCOVERY_POST_BUILD_HOOK = "post-build-hook";

export type PathDiscovery = typeof PATH_DISCOVERY_STORE_SCAN | typeof PATH_DISCOVERY_POST_BUILD_HOOK;

const POST_BUILD_HOOK_STATE_PREFIX = "post_build_hook";

type PostBuildHookState = {
	pathsDir: string;
	eventsLog: string;
	wrapper: string;
	originalHook: string;
};

type DiscoveredHook = {
	source: "CACHIX_DAEMON_DIR" | "NIX_CONF" | "NIX_USER_CONF_FILES";
	hook: string;
};

export const getPathDiscovery = (): PathDiscovery => {
	const pathDiscovery = core.getInput("path-discovery-mode") || PATH_DISCOVERY_STORE_SCAN;

	if (pathDiscovery === PATH_DISCOVERY_STORE_SCAN || pathDiscovery === PATH_DISCOVERY_POST_BUILD_HOOK) {
		return pathDiscovery;
	}

	throw new Error(
		`Unsupported path-discovery-mode value: ${pathDiscovery}. Expected '${PATH_DISCOVERY_STORE_SCAN}' or '${PATH_DISCOVERY_POST_BUILD_HOOK}'.`,
	);
};

export const saveStorePaths = async () => {
	await exec("sh", [
		"-c",
		"nix path-info --all --json --json-format 2 > ${RUNNER_TEMP:-/tmp}/attic-action-store-paths",
	]);
};

export const getStorePaths = async () => {
	const raw = JSON.parse(
		await readFile(`${process.env["RUNNER_TEMP"] || "/tmp"}/attic-action-store-paths`, "utf8"),
	) as {
		info: Record<string, unknown>;
		storeDir: string;
	};

	return Object.keys(raw.info).map((k) => `${raw.storeDir}/${k}`);
};

export const getPostBuildHookPaths = async () => {
	const state = getPostBuildHookState();
	const paths = new Set<string>();

	if (!(await exists(state.pathsDir))) {
		return [];
	}

	const entries = await readdir(state.pathsDir);
	for (const entry of entries) {
		if (!entry.startsWith("paths.")) continue;

		const content = await readFile(join(state.pathsDir, entry), "utf8");
		for (const line of content.split(/\r?\n/)) {
			const path = line.trim();
			if (path !== "") paths.add(path);
		}
	}

	return Array.from(paths).sort();
};

type HookEventRecord = {
	ts?: string;
	pid?: number;
	drvPath?: string | null;
	rawOutPaths?: string;
	paths?: string[];
	pathsFile?: string | null;
	chained?: { hook: string; status: number | null; error?: string } | null;
	skipped?: { reason: string; detail?: string };
	error?: { message: string; stack?: string };
};

const summarizeHookEvent = (event: HookEventRecord, index: number): string => {
	const parts: string[] = [];
	parts.push(`#${index + 1} ${event.ts ?? "?"} pid=${event.pid ?? "?"}`);
	if (event.drvPath) parts.push(`  drv:     ${event.drvPath}`);
	const paths = event.paths ?? [];
	parts.push(`  paths:   ${paths.length}${paths.length > 0 ? ` (${paths.join(", ")})` : ""}`);
	if (event.pathsFile) parts.push(`  file:    ${event.pathsFile}`);
	if (event.skipped) {
		parts.push(`  skipped: ${event.skipped.reason}${event.skipped.detail ? ` — ${event.skipped.detail}` : ""}`);
	}
	if (event.chained) {
		const { hook, status, error } = event.chained;
		parts.push(`  chained: ${hook} (status=${status ?? "n/a"}${error ? `, error=${error}` : ""})`);
	}
	if (event.error) parts.push(`  error:   ${event.error.message}`);
	return parts.join("\n");
};

export const printPostBuildHookCaptureLog = async () => {
	const { eventsLog } = getPostBuildHookState();

	core.startGroup("Attic post-build hook capture log");

	const emptyMessage =
		"No hook invocations were captured. This usually means no new paths were built (e.g. all outputs were already in the store or fetched from a substituter), or less commonly that the collector was not installed in Nix's active config.";

	if (!(await exists(eventsLog))) {
		core.warning(emptyMessage);
		core.endGroup();
		return;
	}

	const content = await readFile(eventsLog, "utf8");
	const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");

	if (lines.length === 0) {
		core.warning(emptyMessage);
		core.endGroup();
		return;
	}

	const events: HookEventRecord[] = [];
	const malformed: string[] = [];
	for (const line of lines) {
		try {
			events.push(JSON.parse(line));
		} catch {
			malformed.push(line);
		}
	}

	const totalPaths = events.reduce((sum, e) => sum + (e.paths?.length ?? 0), 0);
	core.info(`Captured ${events.length} hook invocation(s); ${totalPaths} path(s) reported by Nix.`);

	for (let i = 0; i < events.length; i++) {
		core.info(summarizeHookEvent(events[i]!, i));
	}

	if (malformed.length > 0) {
		core.warning(`Ignored ${malformed.length} malformed event log line(s).`);
		if (core.isDebug()) {
			for (const line of malformed) core.debug(`malformed line: ${line}`);
		}
	}

	if (core.isDebug()) {
		core.startGroup("Raw event log (JSONL)");
		core.debug(content.trimEnd());
		core.endGroup();
	}

	core.endGroup();
};

export const configurePostBuildHookPathDiscovery = async () => {
	const runnerTemp = process.env["RUNNER_TEMP"] || tmpdir();
	const stateDir = join(runnerTemp, "attic-action-post-build-hook");
	const pathsDir = join(stateDir, "paths");
	const eventsLog = join(stateDir, "events.log");
	const wrapper = join(stateDir, "post-build-hook.js");
	const config = join(stateDir, "nix.conf");
	const discoveredHook = await currentPostBuildHook();
	const originalHook = discoveredHook?.hook ?? "";

	// Sticky world-writable so the nix-daemon (root) and the runner user can
	// both read/write here regardless of which one created the dir first.
	await mkdir(pathsDir, { recursive: true, mode: 0o1777 });
	await chmod(pathsDir, 0o1777);
	await writeFile(eventsLog, "", { mode: 0o666 });
	await chmod(eventsLog, 0o666);
	await writeFile(wrapper, postBuildHookScript({ pathsDir, eventsLog, wrapper, originalHook }), { mode: 0o755 });
	await chmod(wrapper, 0o755);
	await writeFile(config, `post-build-hook = ${wrapper}\n`);

	const state: PostBuildHookState = { pathsDir, eventsLog, wrapper, originalHook };
	savePostBuildHookState(state);
	core.exportVariable("ATTIC_POST_BUILD_PATHS_DIR", pathsDir);
	core.exportVariable("ATTIC_POST_BUILD_EVENTS_LOG", eventsLog);
	core.exportVariable("ATTIC_POST_BUILD_HOOK", wrapper);
	core.exportVariable("ATTIC_ORIGINAL_POST_BUILD_HOOK", originalHook);

	if (process.env["NIX_CONF"]) {
		core.exportVariable("NIX_CONF", `${process.env["NIX_CONF"]}\npost-build-hook = ${wrapper}`);
	} else {
		const existingNixUserConfFiles = process.env["NIX_USER_CONF_FILES"];
		core.exportVariable(
			"NIX_USER_CONF_FILES",
			existingNixUserConfFiles ? `${config}:${existingNixUserConfFiles}` : config,
		);
	}

	core.info(`Installed Attic post-build hook collector at ${wrapper}`);
	core.info(`Installed via post-build-hook discovery branch: ${discoveredHook?.source ?? "none"}`);

	if (originalHook) {
		core.info(`Composing with existing post-build hook: ${originalHook}`);
	} else {
		core.warning("No existing post-build hook found");
	}
};

const savePostBuildHookState = ({ pathsDir, eventsLog, wrapper, originalHook }: PostBuildHookState) => {
	core.saveState(`${POST_BUILD_HOOK_STATE_PREFIX}-paths-dir`, pathsDir);
	core.saveState(`${POST_BUILD_HOOK_STATE_PREFIX}-events-log`, eventsLog);
	core.saveState(`${POST_BUILD_HOOK_STATE_PREFIX}-wrapper`, wrapper);
	core.saveState(`${POST_BUILD_HOOK_STATE_PREFIX}-original-hook`, originalHook);
};

const getPostBuildHookState = (): PostBuildHookState => {
	const runnerTemp = process.env["RUNNER_TEMP"] || tmpdir();
	const stateDir = join(runnerTemp, "attic-action-post-build-hook");

	return {
		pathsDir:
			core.getState(`${POST_BUILD_HOOK_STATE_PREFIX}-paths-dir`) ||
			process.env["ATTIC_POST_BUILD_PATHS_DIR"] ||
			join(stateDir, "paths"),
		eventsLog:
			core.getState(`${POST_BUILD_HOOK_STATE_PREFIX}-events-log`) ||
			process.env["ATTIC_POST_BUILD_EVENTS_LOG"] ||
			join(stateDir, "events.log"),
		wrapper:
			core.getState(`${POST_BUILD_HOOK_STATE_PREFIX}-wrapper`) ||
			process.env["ATTIC_POST_BUILD_HOOK"] ||
			join(stateDir, "post-build-hook.js"),
		originalHook:
			core.getState(`${POST_BUILD_HOOK_STATE_PREFIX}-original-hook`) ||
			process.env["ATTIC_ORIGINAL_POST_BUILD_HOOK"] ||
			"",
	};
};

const currentPostBuildHook = async (): Promise<DiscoveredHook | undefined> => {
	const cachixDaemonDir = process.env["CACHIX_DAEMON_DIR"];
	if (cachixDaemonDir) {
		const hook = join(cachixDaemonDir, "post-build-hook.sh");
		if (await exists(hook)) return { source: "CACHIX_DAEMON_DIR", hook };
	}

	const nixConfHook = postBuildHookFromText(process.env["NIX_CONF"] || "");
	if (nixConfHook) return { source: "NIX_CONF", hook: nixConfHook };

	const nixUserConfFiles = process.env["NIX_USER_CONF_FILES"];
	if (nixUserConfFiles) {
		for (const file of nixUserConfFiles.split(":")) {
			if (!file || !(await exists(file))) continue;

			const hook = postBuildHookFromText(await readFile(file, "utf8"));
			if (hook) return { source: "NIX_USER_CONF_FILES", hook };
		}
	}

	return undefined;
};

const postBuildHookFromText = (text: string) => {
	let hook: string | undefined;
	for (const line of text.split(/\r?\n/)) {
		const match = line.match(/^\s*post-build-hook\s*=\s*(.+?)\s*$/);
		if (match?.[1]) hook = match[1].replace(/^"(.*)"$/, "$1");
	}

	return hook;
};

// The wrapper installed into Nix's `post-build-hook` is a tiny Node shim
// that requires the bundled `dist/post-build-hook.js` and invokes it with
// the absolute paths baked in. We do this instead of relying on environment
// variables because the nix-daemon strips/normalizes the env it passes to
// hooks. Bundling lets us write the hook in TypeScript with the same
// toolchain as the rest of the action while keeping the runtime artifact
// fully self-contained (no `node_modules` lookup at hook time).
const postBuildHookScript = (state: PostBuildHookState) => {
	const bundlePath = join(__dirname, "post-build-hook.js");
	const config = JSON.stringify(state);
	return `#!/usr/bin/env node
require(${JSON.stringify(bundlePath)}).runHook(${config});
`;
};

const exists = async (path: string) => {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
};
