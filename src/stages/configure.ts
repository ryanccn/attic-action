import * as core from "@actions/core";
import { exec } from "@actions/exec";
import {
	configurePostBuildHookPathDiscovery,
	getPathDiscovery,
	INTERNAL_DRY_RUN,
	PATH_DISCOVERY_POST_BUILD_HOOK,
	PATH_DISCOVERY_STORE_SCAN,
	saveStorePaths,
} from "../utils";

export const configure = async () => {
	core.startGroup("Configure Attic");

	try {
		const endpoint = core.getInput("endpoint");
		const cache = core.getInput("cache");
		const token = core.getInput("token");
		const skipUse = core.getInput("skip-use");
		const skipPush = core.getInput("skip-push");

		core.info("Logging in to Attic cache");
		if (!INTERNAL_DRY_RUN) await exec("attic", ["login", "--set-default", cache, endpoint, token]);

		if (skipUse === "true") {
			core.info("Not adding Attic cache to substituters as skip-use is set to true");
		} else {
			core.info("Adding Attic cache to substituters");
			if (!INTERNAL_DRY_RUN) await exec("attic", ["use", cache]);
		}

		if (skipPush === "true") {
			core.info("Skipping path discovery setup because skip-push is set to true");
		} else {
			const pathDiscovery = getPathDiscovery();
			if (pathDiscovery === PATH_DISCOVERY_STORE_SCAN) {
				core.info("Collecting store paths before build");
				await saveStorePaths();
			} else if (pathDiscovery === PATH_DISCOVERY_POST_BUILD_HOOK) {
				core.info("Installing post-build hook path discovery");
				await configurePostBuildHookPathDiscovery();
			}
		}
	} catch (e) {
		core.setFailed(`Action failed with error: ${e}`);
	}

	core.endGroup();
};
