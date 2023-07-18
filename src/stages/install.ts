import { startGroup, endGroup, setFailed, info } from "@actions/core";
import { exec } from "@actions/exec";
import { fetch } from "ofetch";

import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const install = async () => {
  startGroup("Install attic");

  info("Installing attic");
  const installScript = await fetch(
    "https://raw.githubusercontent.com/zhaofengli/attic/main/.github/install-attic-ci.sh",
  ).then((r) => {
    if (!r.ok) setFailed(`Action failed with error: ${r.statusText}`);
    endGroup();

    return r.text();
  });

  try {
    const installScriptPath = join(tmpdir(), "install-attic-ci.sh");

    await writeFile(installScriptPath, installScript);
    info("Running install script");
    await exec("bash", [installScriptPath]);
  } catch (e) {
    setFailed(`Action failed with error: ${e}`);
  }

  endGroup();
};
