import { exec } from "@actions/exec";
import { Writable } from "node:stream";

const streamToString = (stream: Writable): Promise<string> => {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", (err) => reject(err));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
};

export const getStorePaths = async () => {
  const outStream = new Writable();
  await exec("nix", ["path-info", "--all"], { outStream });
  const paths = await streamToString(outStream)
    .then((res) => res.split("\n"))
    .then((paths) => paths.filter(Boolean));

  return paths;
};
