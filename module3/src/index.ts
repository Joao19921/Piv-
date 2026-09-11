import "dotenv/config";
import { createModule3App } from "./app";
import { getModule3Config } from "./config";

const config = getModule3Config();
createModule3App(config).listen(config.port, () => {
  console.log(`Módulo 3 ouvindo em http://localhost:${config.port}`);
});