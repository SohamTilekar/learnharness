/**
 * antigravity.ts — Pi Harness antigravity provider integration for LearnHarness.
 *
 * Bridges the user's pi-antigravity extension and accounts into LearnHarness's
 * pi-ai Models collection.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createJiti } from "jiti";
import { createProvider, type Provider } from "@earendil-works/pi-ai";

export interface AntigravityAccountStatus {
	configured: boolean;
	email?: string;
	projectId?: string;
	error?: string;
}

export function getAntigravityAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

export function getAntigravityDir(): string | null {
	const agentDir = getAntigravityAgentDir();
	const extDir = path.join(agentDir, "npm", "node_modules", "pi-antigravity");
	if (fs.existsSync(extDir)) return extDir;

	const localDir = path.join(process.cwd(), "node_modules", "pi-antigravity");
	if (fs.existsSync(localDir)) return localDir;

	return null;
}

export function getAntigravityAccountStatus(): AntigravityAccountStatus {
	const accountsPath = path.join(getAntigravityAgentDir(), "antigravity-accounts.json");
	if (!fs.existsSync(accountsPath)) {
		return { configured: false, error: "antigravity-accounts.json not found" };
	}

	try {
		const raw = JSON.parse(fs.readFileSync(accountsPath, "utf-8"));
		const activeId = raw.activeAccountId;
		const account = activeId && raw.accounts ? raw.accounts[activeId] : null;

		if (!account || (!account.access && !account.refresh)) {
			return { configured: false, error: "No active authenticated account" };
		}

		return {
			configured: true,
			email: account.email || activeId,
			projectId: account.projectId,
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { configured: false, error: msg };
	}
}

let cachedProvider: Provider | null | undefined = undefined;

/**
 * Loads the Antigravity provider using the installed pi-antigravity extension
 * and active account credentials.
 */
export function getAntigravityProvider(): Provider | null {
	if (cachedProvider !== undefined) return cachedProvider;

	const extDir = getAntigravityDir();
	if (!extDir) {
		cachedProvider = null;
		return null;
	}

	try {
		const root = process.cwd();
		const piAiPath = path.resolve(root, "node_modules/@earendil-works/pi-ai/dist/index.js");
		const piAiCompatPath = path.resolve(root, "node_modules/@earendil-works/pi-ai/dist/compat.js");
		const undiciPath = path.resolve(root, "node_modules/undici/index.js");

		const jiti = createJiti(root, {
			alias: {
				"@earendil-works/pi-ai": piAiPath,
				"@earendil-works/pi-ai/compat": piAiCompatPath,
				undici: fs.existsSync(undiciPath) ? undiciPath : "undici",
			},
		});

		const indexPath = path.join(extDir, "src", "index.ts");
		if (!fs.existsSync(indexPath)) {
			cachedProvider = null;
			return null;
		}

		const extMod = jiti(indexPath) as { default: (pi: unknown) => void };
		let registered: { id: string; config: Record<string, unknown> } | null = null;
		const mockPi = {
			on: () => {},
			registerProvider: (id: string, config: Record<string, unknown>) => {
				registered = { id, config };
			},
			registerCommand: () => {},
		};

		extMod.default(mockPi);

		if (!registered) {
			cachedProvider = null;
			return null;
		}

		const reg = registered as { id: string; config: Record<string, any> };

		const authHelper = {
			apiKey: {
				name: "Antigravity OAuth (Pi Harness)",
				async check() {
					const status = getAntigravityAccountStatus();
					return status.configured
						? { type: "api_key" as const, source: `Pi Harness (${status.email})` }
						: undefined;
				},
				async resolve() {
					const status = getAntigravityAccountStatus();
					if (!status.configured) return undefined;

					const accountsPath = path.join(getAntigravityAgentDir(), "antigravity-accounts.json");
					const raw = JSON.parse(fs.readFileSync(accountsPath, "utf-8"));
					const account = raw.accounts[raw.activeAccountId];

					// Check if token needs refresh (within 5 minutes of expiration)
					let accessToken = account.access;
					const expires = account.expires || 0;
					if (Date.now() > expires - 5 * 60 * 1000 && account.refresh) {
						try {
							const oauthMod = jiti(path.join(extDir, "src", "auth", "oauth.ts")) as {
								refreshAntigravityToken: (acc: unknown) => Promise<any>;
							};
							const accountsMod = jiti(path.join(extDir, "src", "auth", "accounts.ts")) as {
								updateRememberedAccount: (orig: unknown, updated: unknown) => void;
							};
							const refreshed = await oauthMod.refreshAntigravityToken(account);
							accountsMod.updateRememberedAccount(account, refreshed);
							accessToken = refreshed.access;
						} catch {
							// If refresh fails, try using existing access token
						}
					}

					return {
						auth: {
							apiKey: JSON.stringify({
								token: accessToken,
								projectId: account.projectId || "aicode-consumers",
							}),
							headers: {
								Authorization: `Bearer ${accessToken}`,
								"Content-Type": "application/json",
							},
						},
						source: `Pi Harness (${status.email})`,
					};
				},
			},
		};

		const models = (reg.config.models || []).map((m: any) => ({
			...m,
			provider: reg.id || "antigravity",
		}));

		cachedProvider = createProvider({
			id: reg.id,
			name: reg.config.name,
			baseUrl: reg.config.baseUrl,
			auth: authHelper,
			models,
			api: {
				stream: reg.config.streamSimple,
				streamSimple: reg.config.streamSimple,
			},
		});

		return cachedProvider;
	} catch (err) {
		console.error("[LearnHarness] Failed to initialize Antigravity provider:", err);
		cachedProvider = null;
		return null;
	}
}

export function resetAntigravityProviderCacheForTests(): void {
	cachedProvider = undefined;
}
