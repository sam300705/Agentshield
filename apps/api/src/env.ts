import { fileURLToPath } from "node:url";

import { config } from "dotenv";

// src and dist are both one directory below the API package root.
// Existing process values take precedence over the shared local environment.
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
