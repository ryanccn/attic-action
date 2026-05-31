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

export const printPostBuildHookCaptureLog = async () => {
	const { eventsLog } = getPostBuildHookState();

	core.startGroup("Attic post-build hook capture log");
	if (await exists(eventsLog)) {
		const content = await readFile(eventsLog, "utf8");
		if (content.trim() !== "") {
			core.info(content.trimEnd());
		} else {
			core.warning("No hook invocations were captured. This usually means no new paths were built (e.g. all outputs were already in the store or fetched from a substituter), or less commonly that the collector was not installed in Nix's active config.");
		}
	} else {
		core.warning("No hook invocations were captured. This usually means no new paths were built (e.g. all outputs were already in the store or fetched from a substituter), or less commonly that the collector was not installed in Nix's active config.");
	}
	core.endGroup();
};

export const configurePostBuildHookPathDiscovery = async () => {
	const runnerTemp = process.env["RUNNER_TEMP"] || tmpdir();
	const stateDir = join(runnerTemp, "attic-action-post-build-hook");
	const pathsDir = join(stateDir, "paths");
	const eventsLog = join(stateDir, "events.log");
	const wrapper = join(stateDir, "post-build-hook.sh");
	const config = join(stateDir, "nix.conf");
	const discoveredHook = await currentPostBuildHook();
	const originalHook = discoveredHook?.hook ?? "";

	await mkdir(pathsDir, { recursive: true });
	await writeFile(eventsLog, "");
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
			join(stateDir, "post-build-hook.sh"),
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

const postBuildHookScript = ({ pathsDir, eventsLog, wrapper, originalHook }: PostBuildHookState) => `#!/usr/bin/env bash
set -euo pipefail

paths_dir=${shellQuote(pathsDir)}
events_log=${shellQuote(eventsLog)}
wrapper=${shellQuote(wrapper)}
original_hook=${shellQuote(originalHook)}

record_out_paths() {
  if [[ -z "\${OUT_PATHS:-}" ]]; then
    return 0
  fi

  mkdir -p "$paths_dir"
  tmp=$(mktemp "$paths_dir/paths.XXXXXX")
  kept=0

  {
    {
      printf 'hook %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      printf 'raw OUT_PATHS: %s\n' "$OUT_PATHS"
      printf 'filtered paths:\n'
    } >> "$events_log"

    for path in $OUT_PATHS; do
      case "$path" in
        *.drv | *.drv.chroot | *.check | *.lock) ;;
        *)
          printf '%s\n' "$path"
          printf '  %s\n' "$path" >> "$events_log"
          kept=$((kept + 1))
          ;;
      esac
    done

    printf 'kept: %s\n\n' "$kept" >> "$events_log"
  } > "$tmp"

  if [[ "$kept" -eq 0 ]]; then
    rm -f "$tmp"
  fi
}

if ! record_out_paths; then
  echo "attic-action post-build hook: failed to record OUT_PATHS; continuing" >&2
fi

if [[ -n "$original_hook" ]]; then
  if [[ "$original_hook" == "$wrapper" ]]; then
    echo "attic-action post-build hook: original hook points to this wrapper; skipping to avoid recursion" >&2
    exit 0
  fi

  if [[ -x "$original_hook" ]]; then
    printf 'chaining original hook: %s\n\n' "$original_hook" >> "$events_log"
    "$original_hook" "$@"
  else
    echo "attic-action post-build hook: original hook is not executable: $original_hook" >&2
  fi
fi
`;

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const exists = async (path: string) => {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
};
