import * as core from "@actions/core";
import { exec } from "@actions/exec";
import { findInPath } from "@actions/io";

export const install = async () => {
	core.startGroup("Install attic");

	core.info("Installing attic");

	try {
		await exec("nix", ["profile", "install", "github:NixOS/nixpkgs/nixpkgs-unstable#attic-client"]);
	} catch (e) {
		core.setFailed(`Action failed with error: ${e}`);
	}

	core.endGroup();
};

export const isInstalled = async () => {
	return (await findInPath("attic")).length > 0;
};
