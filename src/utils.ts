import { exec } from "@actions/exec";
import { Writable } from "node:stream";

class StringStream extends Writable {
	chunks: Buffer[] = [];

	_write(chunk: WithImplicitCoercion<ArrayBuffer | SharedArrayBuffer>, _enc: unknown, next: () => unknown) {
		this.chunks.push(Buffer.from(chunk));
		next();
	}

	string() {
		return Buffer.concat(this.chunks).toString("utf-8");
	}
}

export const getStorePaths = async () => {
	const outStream = new StringStream();
	await exec("nix", ["path-info", "--all"], { outStream });
	const paths = outStream.string().split("\n").filter(Boolean);

	return paths;
};
