/**
 * verify-antigravity.mjs — Pre-flight verification for pi-antigravity.
 *
 * Ensures the pi-antigravity extension is installed in the Pi harness and an
 * active Google account is configured and authenticated before running production.
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { checkAntigravityStatus, ensureAntigravitySettings } = require("../electron/verify-antigravity.cjs");

export { checkAntigravityStatus, ensureAntigravitySettings };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	const status = checkAntigravityStatus();
	if (!status.ok) {
		console.error("\n========================================================");
		console.error("[LearnHarness] ERROR: pi-antigravity check failed before production run.");
		console.error(status.error);
		console.error("To fix this, please complete the following steps:");
		console.error(`  ${status.remedy}`);
		console.error("========================================================\n");
		process.exit(1);
	}
	const dataDir = process.env.LH_DATA_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
	ensureAntigravitySettings(dataDir);
	console.log(`[LearnHarness] pi-antigravity verification passed (Account: ${status.email})`);
	console.log("[LearnHarness] Configured default models to use Antigravity (gemini-3.8-flash).");
}
