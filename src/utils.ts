import { exec } from "@actions/exec";

import { readFile } from "node:fs/promises";

export const saveStorePaths = async () => {
	await exec("sh", ["-c", "nix path-info --all --json > /tmp/store-paths"]);
};

export const getStorePaths = async () => {
	const rawStorePaths = JSON.parse(await readFile("/tmp/store-paths", "utf8")) as { path: string }[];

	// compatibility with Nix 2.18
	if (Array.isArray(rawStorePaths)) {
		return rawStorePaths.map((path) => path.path);
	}

	return Object.keys(rawStorePaths);
};
