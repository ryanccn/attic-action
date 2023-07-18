import { install } from "./stages/install";
import { configure } from "./stages/configure";

(async () => {
  await install();
  await configure();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
