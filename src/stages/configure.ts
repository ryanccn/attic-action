import { getInput, startGroup, endGroup, setFailed, info } from "@actions/core";
import { exec } from "@actions/exec";

export const configure = async () => {
  startGroup("Configure attic");

  try {
    const endpoint = getInput("endpoint");
    const cache = getInput("cache");
    const token = getInput("token");

    info("Logging in to attic cache");
    await exec("attic", ["login", "--set-default", cache, endpoint, token]);
    // remember existing source paths
    info("Collecting store paths before build");
    await exec(`${__dirname}/list-nix-store.sh > /tmp/store-path-pre-build`);
  } catch (e) {
    setFailed(`Action failed with error: ${e}`);
  }

  endGroup();
};
