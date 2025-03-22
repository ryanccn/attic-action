import * as core from "@actions/core";
import { exec } from "@actions/exec";
import { findInPath } from "@actions/io";

export const install = async () => {
	core.startGroup("Install Attic");

	core.info("Installing Attic");

	const inputsFrom = core.getInput("inputs-from");

	try {
		if (inputsFrom) {
			await exec("nix", ["profile", "install", "--inputs-from", inputsFrom, "nixpkgs#attic-client"]);
		} else {
			await exec("nix", ["profile", "install", "github:NixOS/nixpkgs/nixpkgs-unstable#attic-client"]);
		}
	} catch (e) {
		core.setFailed(`Action failed with error: ${e}`);
	}

	core.endGroup();
};

export const isInstalled = async () => {
	return (await findInPath("attic")).length > 0;
};
