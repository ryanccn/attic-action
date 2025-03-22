import * as core from "@actions/core";
import { exec } from "@actions/exec";
import { saveStorePaths } from "../utils";

export const configure = async () => {
	core.startGroup("Configure Attic");

	try {
		const endpoint = core.getInput("endpoint");
		const cache = core.getInput("cache");
		const token = core.getInput("token");
		const skipUse = core.getInput("skip-use");

		core.info("Logging in to Attic cache");
		await exec("attic", ["login", "--set-default", cache, endpoint, token]);

		if (skipUse === "true") {
			core.info("Not adding Attic cache to substituters as skip-use is set to true");
		} else {
			core.info("Adding Attic cache to substituters");
			await exec("attic", ["use", cache]);
		}

		core.info("Collecting store paths before build");
		await saveStorePaths();
	} catch (e) {
		core.setFailed(`Action failed with error: ${e}`);
	}

	core.endGroup();
};
