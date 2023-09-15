import * as core from "@actions/core";
import { exec } from "@actions/exec";

import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const install = async () => {
	core.startGroup("Install attic");

	core.info("Installing attic");
	const installScript = await fetch(
		"https://raw.githubusercontent.com/zhaofengli/attic/main/.github/install-attic-ci.sh",
	).then((r) => {
		if (!r.ok) {
			core.setFailed(`Action failed with error: ${r.statusText}`);
			core.endGroup();
			process.exit(1);
		}

		return r.text();
	});

	try {
		const installScriptPath = join(tmpdir(), "install-attic-ci.sh");

		await writeFile(installScriptPath, installScript);
		core.info("Running install script");
		await exec("bash", [installScriptPath]);
	} catch (e) {
		core.setFailed(`Action failed with error: ${e}`);
	}

	core.endGroup();
};
