import { defineConfig } from "vitest/config";

import nodeConfig from "./vitest.node.config.ts";
import workerConfig from "./vitest.worker.config.ts";

export default defineConfig({
  test: {
    projects: [nodeConfig, workerConfig],
  },
});
