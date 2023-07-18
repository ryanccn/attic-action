import { install } from "./stages/install";
import { configure } from "./stages/configure";
import { push } from "./stages/push";

(async () => {
  await install();
  await configure();
  await push();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
