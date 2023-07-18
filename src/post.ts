import { push } from "./stages/push";

(async () => {
  await push();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
