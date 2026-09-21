import { getInput } from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";

import { readFile, writeFile } from "node:fs/promises";

export const INTERNAL_DRY_RUN = ["true", "1", "yes"].includes(
	getInput("__internal-dry-run", { required: false, trimWhitespace: true }),
);

const STORE_PATHS = `${process.env["RUNNER_TEMP"] || "/tmp"}/attic-action-store-paths`;

export const saveStorePaths = async () => {
	const supportsJSONFormat = await getExecOutput("nix", ["path-info", "--help"], {
		ignoreReturnCode: true,
		silent: true,
	}).then(({ stdout }) => stdout.includes("--json-format"));

	let paths = [];

	if (supportsJSONFormat) {
		const { stdout } = await getExecOutput("nix", ["path-info", "--all", "--json", "--json-format", "2"], {
			silent: true,
		});
		const data = JSON.parse(stdout) as { info: Record<string, unknown>; storeDir: string };
		paths = Object.keys(data.info).map((k) => `${data.storeDir}/${k}`);
	} else {
		const { stdout } = await getExecOutput("nix", ["path-info", "--all", "--json"], { silent: true });
		const data = JSON.parse(stdout) as Record<string, unknown>;
		paths = Object.keys(data);
	}

	await writeFile(STORE_PATHS, paths.join("\n"));
};

export const getStorePaths = async () => {
	return readFile(STORE_PATHS, { encoding: "utf8" }).then((raw) => raw.split("\n").filter(Boolean));
};
