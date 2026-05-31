import * as core from "@actions/core";
import { exec } from "@actions/exec";

import {
	getPathDiscovery,
	getPostBuildHookPaths,
	getStorePaths,
	INTERNAL_DRY_RUN,
	PATH_DISCOVERY_POST_BUILD_HOOK,
	PATH_DISCOVERY_STORE_SCAN,
	printPostBuildHookCaptureLog,
	saveStorePaths,
} from "../utils";

const excludeTemporaryPaths = (paths: string[]) =>
	paths.filter(
		(p) => !p.endsWith(".drv") && !p.endsWith(".drv.chroot") && !p.endsWith(".check") && !p.endsWith(".lock"),
	);

const applyPathFilters = (paths: string[]) => {
	let pushPaths = paths;

	const includePaths = core.getMultilineInput("include-paths").map((v) => new RegExp(v));
	if (includePaths.length > 0) {
		pushPaths = pushPaths.filter((p) => includePaths.some((v) => v.test(p)));
	}

	const excludePaths = core.getMultilineInput("exclude-paths").map((v) => new RegExp(v));
	if (excludePaths.length > 0) {
		pushPaths = pushPaths.filter((p) => !excludePaths.some((v) => v.test(p)));
	}

	return pushPaths;
};

export const push = async () => {
	core.startGroup("Push to Attic");

	try {
		const skipPush = core.getInput("skip-push");

		if (skipPush === "true") {
			core.info("Pushing to cache is disabled by skip-push");
		} else {
			const cache = core.getInput("cache");
			const pathDiscovery = getPathDiscovery();
			core.info("Pushing to cache");

			let pushPaths: string[];
			if (pathDiscovery === PATH_DISCOVERY_STORE_SCAN) {
				const oldPaths = await getStorePaths();
				await saveStorePaths();
				const newPaths = await getStorePaths();
				pushPaths = newPaths.filter((p) => !oldPaths.includes(p));
			} else if (pathDiscovery === PATH_DISCOVERY_POST_BUILD_HOOK) {
				await printPostBuildHookCaptureLog();
				pushPaths = await getPostBuildHookPaths();
			} else {
				throw new Error(`Unsupported path-discovery-mode value: ${pathDiscovery}`);
			}

			// The post-build hook should only receive real build outputs, but keep
			// the same temporary-path guard for both discovery modes for consistency.
			pushPaths = excludeTemporaryPaths(pushPaths);
			pushPaths = applyPathFilters(pushPaths);
			core.info(`Discovered ${pushPaths.length} store path(s) to push using ${pathDiscovery}`);

			if (!INTERNAL_DRY_RUN) {
				await exec("attic", ["push", "--stdin", cache], {
					input: Buffer.from(pushPaths.join("\n")),
				});
			} else {
				console.log("Pushing paths", pushPaths);
			}
		}
	} catch (e) {
		core.warning(`Action encountered error: ${e}`);
		core.info("Not considering errors during push a failure.");
	}

	core.endGroup();
};
