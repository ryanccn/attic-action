import * as core from "@actions/core";
import { exec } from "@actions/exec";
import { getStorePaths } from "../utils";

export const push = async () => {
  core.startGroup("Push to Attic");

  try {
    const skipPush = core.getInput("skip-push");
    if (skipPush === "true") {
      core.info("Pushing to cache is disabled by skip-push");
    } else {
      const cache = core.getInput("cache");

      core.info("Pushing to cache");
      const oldPaths = JSON.parse(core.getState("initial-paths")) as string[];
      const newPaths = await getStorePaths();
      const addedPaths = newPaths.filter((p) => !oldPaths.includes(p));

      await exec("attic", ["push", cache, ...addedPaths]);
    }
  } catch (e) {
    core.setFailed(`Action failed with error: ${e}`);
  }

  core.endGroup();
};
