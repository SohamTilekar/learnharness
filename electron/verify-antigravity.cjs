/**
 * verify-antigravity.cjs — Electron main process verification for pi-antigravity.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function checkAntigravityStatus(customPiDir) {
	const agentDir = customPiDir || process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
	const settingsPath = path.join(agentDir, "settings.json");
	const accountsPath = path.join(agentDir, "antigravity-accounts.json");
	const extensionDir = path.join(agentDir, "npm", "node_modules", "pi-antigravity");

	let isInstalled = false;
	if (fs.existsSync(extensionDir)) {
		isInstalled = true;
	} else if (fs.existsSync(settingsPath)) {
		try {
			const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
			if (Array.isArray(settings?.packages)) {
				isInstalled = settings.packages.some((pkg) => {
					if (typeof pkg === "string") return pkg.includes("pi-antigravity");
					if (pkg && typeof pkg === "object" && typeof pkg.source === "string") {
						return pkg.source.includes("pi-antigravity");
					}
					return false;
				});
			}
		} catch {
			// ignore
		}
	}

	if (!isInstalled) {
		return {
			ok: false,
			error: "pi-antigravity extension is not installed in the Pi harness.",
			remedy: "Run: pi install npm:pi-antigravity",
		};
	}

	if (!fs.existsSync(accountsPath)) {
		return {
			ok: false,
			error: "pi-antigravity is installed but no active account is configured.",
			remedy: "Run 'pi' and execute: /login antigravity",
		};
	}

	try {
		const accountsData = JSON.parse(fs.readFileSync(accountsPath, "utf-8"));
		const activeId = accountsData.activeAccountId;
		const account = activeId && accountsData.accounts ? accountsData.accounts[activeId] : null;

		if (!account || (!account.access && !account.refresh)) {
			return {
				ok: false,
				error: "No active authenticated Google account found in antigravity-accounts.json.",
				remedy: "Run 'pi' and execute: /login antigravity",
			};
		}

		return {
			ok: true,
			email: account.email || activeId,
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			ok: false,
			error: `Could not parse antigravity-accounts.json: ${msg}`,
			remedy: "Run 'pi' and execute: /login antigravity",
		};
	}
}

function ensureAntigravitySettings(dataDir) {
	const settingsPath = path.join(dataDir, "settings.json");
	let settings = { version: 1 };
	if (fs.existsSync(settingsPath)) {
		try {
			settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) || { version: 1 };
		} catch {
			settings = { version: 1 };
		}
	}
	if (!settings.models || !settings.models.strong || !settings.models.strong.model) {
		settings.models = {
			strong: { model: { provider: "antigravity", id: "gemini-3.8-flash" } },
			cheap: { model: { provider: "antigravity", id: "gemini-3.8-flash" } },
			vision: { model: { provider: "antigravity", id: "gemini-3.8-flash" } },
		};
		fs.mkdirSync(dataDir, { recursive: true });
		fs.writeFileSync(settingsPath, JSON.stringify(settings, null, "\t"), "utf-8");
	}
}

module.exports = { checkAntigravityStatus, ensureAntigravitySettings };
