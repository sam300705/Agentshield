import { checkWorkerHealth } from "./workerHealth.js";
process.exitCode = (await checkWorkerHealth()) ? 0 : 1;
