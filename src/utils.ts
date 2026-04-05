import { getInput } from "@actions/core";
import { exec } from "@actions/exec";

import { readFile } from "node:fs/promises";

export const INTERNAL_DRY_RUN = ["true", "1", "yes"].includes(
	getInput("__internal-dry-run", { required: false, trimWhitespace: true }),
);

export const saveStorePaths = async () => {
	await exec("sh", [
		"-c",
		"nix path-info --all --json --json-format 2 > ${RUNNER_TEMP:-/tmp}/attic-action-store-paths",
	]);
};

export const getStorePaths = async () => {
	const raw = JSON.parse(
		await readFile(`${process.env["RUNNER_TEMP"] || "/tmp"}/attic-action-store-paths`, "utf8"),
	) as {
		info: Record<string, unknown>;
	};

	return Object.keys(raw.info);
};
