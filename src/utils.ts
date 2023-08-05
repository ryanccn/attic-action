import { exec } from "@actions/exec";

import { readFile } from "node:fs/promises";

export const saveStorePaths = async () => {
	await exec("sh", ["-c", "nix  path-info --all --json > /tmp/store-paths"]);
};
export const getStorePaths = async () => {
	return JSON.parse(await readFile("/tmp/store-paths", "utf8")).map((path) => path.path);
};
