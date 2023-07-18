import { getInput, startGroup, endGroup } from "@actions/core";
import { exec } from "@actions/exec";

export const configure = async () => {
  startGroup("Configure attic");
  const endpoint = getInput("endpoint");
  const cache = getInput("cache");
  const token = getInput("token");

  await exec("attic", ["login", "--set-default", cache, endpoint, token]);
  endGroup();
};
