import * as core from "@actions/core";
import { exec } from "@actions/exec";

import { saveStorePaths, getStorePaths } from "../utils";

export const push = async () => {
	core.startGroup("Push to Attic");

	try {
		const skipPush = core.getInput("skip-push");

		if (skipPush === "true") {
			core.info("Pushing to cache is disabled by skip-push");
		} else {
			const cache = core.getInput("cache");
			core.info("Pushing to cache");

			const oldPaths = await getStorePaths();
			await saveStorePaths();
			const newPaths = await getStorePaths();

			let pushPaths = newPaths
				.filter((p) => !oldPaths.includes(p))
				.filter(
					(p) => !p.endsWith(".drv") && !p.endsWith(".drv.chroot") && !p.endsWith(".check") && !p.endsWith(".lock"),
				);

			const includePaths = core.getMultilineInput("include-paths").map((v) => new RegExp(v));
			if (includePaths.length > 0) {
				pushPaths = pushPaths.filter((p) => includePaths.some((v) => v.test(p)));
			}

			const excludePaths = core.getMultilineInput("exclude-paths").map((v) => new RegExp(v));
			if (excludePaths.length > 0) {
				pushPaths = pushPaths.filter((p) => !excludePaths.some((v) => v.test(p)));
			}

			await exec("attic", ["push", "--stdin", cache], {
				input: Buffer.from(pushPaths.join("\n")),
			});
		}
	} catch (e) {
		core.warning(`Action encountered error: ${e}`);
		core.info("Not considering errors during push a failure.");
	}

	core.endGroup();
};
