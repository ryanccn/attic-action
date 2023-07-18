import { startGroup, endGroup } from "@actions/core";
import { exec } from "@actions/exec";
import { fetch } from "ofetch";

import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const install = async () => {
  startGroup("Install attic");

  const installScript = await fetch(
    "https://raw.githubusercontent.com/zhaofengli/attic/main/.github/install-attic-ci.sh",
  ).then((r) => {
    if (!r.ok)
      throw new Error(
        `Failed to fetch install script: ${r.status} ${r.statusText}`,
      );

    return r.text();
  });

  const installScriptPath = join(tmpdir(), "install-attic-ci.sh");

  await writeFile(installScriptPath, installScript);
  await exec("bash", [installScriptPath]);

  endGroup();
};
