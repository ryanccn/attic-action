import { getInput, getMultilineInput } from "@actions/core";
import { exec } from "@actions/exec";

export const push = async () => {
  const cache = getInput("cache");
  const paths = getMultilineInput("paths");

  await exec("attic", ["push", cache, ...paths]);
};
