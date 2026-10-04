#!/usr/bin/env node

/* global process, console */

import { runCli } from "../dist/index.js";

runCli(process.argv).catch((err) => {
  console.error("Fatal execution error", err);
  process.exit(2);
});
