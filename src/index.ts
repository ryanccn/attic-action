import { install } from "./stages/install";
import { configure } from "./stages/configure";

const main = async () => {
  await install();
  await configure();
};

main();
