import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { checkAntigravityStatus, ensureAntigravitySettings } from "../scripts/verify-antigravity.mjs";
import {
	getAntigravityAccountStatus,
	getAntigravityProvider,
} from "../src/agent/antigravity.ts";
import { piModels } from "../src/agent/models.ts";
import { modelCatalog } from "../src/server/model-catalog.ts";

describe("pi-antigravity verification gate", () => {
	it("passes when pi-antigravity is installed and active account is authenticated", () => {
		const status = checkAntigravityStatus();
		assert.equal(status.ok, true);
		assert.ok(typeof status.email === "string" && status.email.length > 0);
	});

	it("fails when pi-antigravity is not installed", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-ag-test-missing-"));
		try {
			const status = checkAntigravityStatus(tmp);
			assert.equal(status.ok, false);
			assert.match(status.error ?? "", /not installed/i);
			assert.match(status.remedy ?? "", /pi install npm:pi-antigravity/i);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("fails when pi-antigravity is installed in settings.json but not logged in", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-ag-test-unauthed-"));
		try {
			fs.writeFileSync(
				path.join(tmp, "settings.json"),
				JSON.stringify({ packages: ["npm:pi-antigravity"] }),
				"utf-8",
			);
			const status = checkAntigravityStatus(tmp);
			assert.equal(status.ok, false);
			assert.match(status.error ?? "", /no active account/i);
			assert.match(status.remedy ?? "", /\/login antigravity/i);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("fails when antigravity-accounts.json has no valid tokens", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-ag-test-invalid-"));
		try {
			fs.writeFileSync(
				path.join(tmp, "settings.json"),
				JSON.stringify({ packages: ["npm:pi-antigravity"] }),
				"utf-8",
			);
			fs.writeFileSync(
				path.join(tmp, "antigravity-accounts.json"),
				JSON.stringify({ activeAccountId: "test@example.com", accounts: {} }),
				"utf-8",
			);
			const status = checkAntigravityStatus(tmp);
			assert.equal(status.ok, false);
			assert.match(status.error ?? "", /No active authenticated Google account/i);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("LearnHarness antigravity provider integration", () => {
	it("reads active account status from antigravity-accounts.json", () => {
		const status = getAntigravityAccountStatus();
		assert.equal(status.configured, true);
		assert.ok(status.email);
	});

	it("registers antigravity provider in piModels", () => {
		const provider = getAntigravityProvider();
		assert.ok(provider, "provider should be loaded");
		assert.equal(provider.id, "antigravity");
		assert.equal(provider.name, "Antigravity");

		const models = provider.getModels();
		assert.ok(models.length >= 8);
		const ids = models.map((m) => m.id);
		assert.ok(ids.includes("gemini-3.8-flash"));
		assert.ok(ids.includes("claude-sonnet-4-6"));
		assert.ok(ids.includes("gemini-3.1-pro"));

		const modelInCollection = piModels().getModel("antigravity", "gemini-3.8-flash");
		assert.ok(modelInCollection);
		assert.equal(modelInCollection.provider, "antigravity");
		assert.equal(modelInCollection.name, "Gemini 3.8 Flash (Antigravity)");
	});

	it("ensures default model slots use antigravity and are federated in the catalog", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-ag-settings-test-"));
		try {
			ensureAntigravitySettings(tmp);
			const saved = JSON.parse(fs.readFileSync(path.join(tmp, "settings.json"), "utf-8"));
			assert.equal(saved.models.strong.model.provider, "antigravity");
			assert.equal(saved.models.strong.model.id, "gemini-3.8-flash");
			assert.equal(saved.models.cheap.model.provider, "antigravity");
			assert.equal(saved.models.vision.model.provider, "antigravity");
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}

		const catalog = modelCatalog();
		assert.equal(catalog.slots.strong?.model.provider, "antigravity");
		assert.equal(catalog.slots.cheap?.model.provider, "antigravity");
		assert.equal(catalog.slots.vision?.model.provider, "antigravity");
		assert.equal(catalog.defaults?.model.provider, "antigravity");
	});
});
