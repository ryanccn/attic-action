import { install } from "./stages/install";
import { configure } from "./stages/configure";
import { push } from "./stages/push";
import { getState, saveState } from "@actions/core";

const isPost = !!getState("isPost");

async function setup() {
  await install();
  await configure();
}

if (!isPost) {
  saveState("isPost", "true");
  setup();
} else {
  push();
}
