import * as core from "@actions/core";
import { exec } from "@actions/exec";

import splitArray from "just-split";
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
			const oldPaths = await 	getStorePaths();
			await saveStorePaths();
			const newPaths = await getStorePaths(); 
			const addedPaths = newPaths
				.filter((p) => !oldPaths.includes(p))
				.filter(
					(p) => !p.endsWith(".drv") && !p.endsWith(".drv.chroot") && !p.endsWith(".check") && !p.endsWith(".lock"),
				);

			const splitAddedPaths = splitArray(addedPaths, 25);
			for (const addedPaths of splitAddedPaths) {
				await exec("attic", ["push", cache, ...addedPaths]);
			}
		}
	} catch (e) {
		core.setFailed(`Action failed with error: ${e}`);
	}

	core.endGroup();
};
