import * as core from "@actions/core";
import { exec } from "@actions/exec";
import { saveStorePaths } from "../utils";

export const configure = async () => {
	core.startGroup("Configure attic");

	try {
		const endpoint = core.getInput("endpoint");
		const cache = core.getInput("cache");
		const token = core.getInput("token");

		core.info("Logging in to attic cache");
		await exec("attic", ["login", "--set-default", cache, endpoint, token]);

		core.info("Collecting store paths before build");
		await saveStorePaths();
	} catch (e) {
		core.setFailed(`Action failed with error: ${e}`);
	}

	core.endGroup();
};
