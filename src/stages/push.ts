import * as core from "@actions/core";
import { exec } from "@actions/exec";

export const push = async () => {
  core.startGroup("Push to Attic");

  try {
    const skipPush = core.getInput("skip-push");
    if (skipPush === "true") {
      core.info("Pushing to cache is disabled by skip-push");
    } else {
      const cache = core.getInput("cache");

      core.info("Pushing to cache");
      await exec(`${__dirname}/push-paths.sh`, ["attic", cache]);
    }
  } catch (e) {
    core.setFailed(`Action failed with error: ${e}`);
  }

  core.endGroup();
};
