import { runManifestTests } from "./qa-tests/manifest-tests.mjs";
import { runDataModelTests } from "./qa-tests/data-model-tests.mjs";
import { runCalculationTests } from "./qa-tests/calculation-tests.mjs";
import { runTransformationTests } from "./qa-tests/transformation-tests.mjs";
import { runSheetRenderTests } from "./qa-tests/sheet-render-tests.mjs";
import { runSheetInteractionTests } from "./qa-tests/sheet-interaction-tests.mjs";
import { runRollTests } from "./qa-tests/roll-tests.mjs";
import { runAttackDialogTests } from "./qa-tests/attack-dialog-tests.mjs";
import { runCompendiumTests } from "./qa-tests/compendium-tests.mjs";
import { runMigrationTests } from "./qa-tests/migration-tests.mjs";
import { runCombatStateTests } from "./qa-tests/combat-state-tests.mjs";
import { runReactionTests } from "./qa-tests/reaction-tests.mjs";
import { runRecoveryTests } from "./qa-tests/recovery-tests.mjs";
import { runXpTests } from "./qa-tests/xp-tests.mjs";
import { runTravelTests } from "./qa-tests/travel-tests.mjs";
import { runGmToolsTests } from "./qa-tests/gm-tools-tests.mjs";
import { runPermissionTests } from "./qa-tests/permission-tests.mjs";

const MODULE_ID = "dbz-fuzion-calibrated-qa";
const FIXTURE_SETTING = "trackedFixtures";

const TESTS = {
  manifest: runManifestTests,
  data: runDataModelTests,
  calculations: runCalculationTests,
  transformations: runTransformationTests,
  sheetRender: runSheetRenderTests,
  sheetInteraction: runSheetInteractionTests,
  rolls: runRollTests,
  attacks: runAttackDialogTests,
  compendia: runCompendiumTests,
  migrations: runMigrationTests,
  combatState: runCombatStateTests,
  reactions: runReactionTests,
  recovery: runRecoveryTests,
  xp: runXpTests,
  travel: runTravelTests,
  gmTools: runGmToolsTests,
  permissions: runPermissionTests
};

export class DBZFQARunner {
  constructor() {
    this.fixtures = loadTrackedFixtures();
    this.lastReport = null;
  }

  async runAll() {
    return this.#runSuites(Object.keys(TESTS));
  }

  async runGroup(group) {
    const groups = {
      calculations: ["calculations"],
      transformations: ["transformations"],
      sheets: ["sheetRender", "sheetInteraction"],
      rollsAttacks: ["rolls", "attacks"],
      compendia: ["compendia"],
      gmTools: ["gmTools"],
      combat: ["combatState", "reactions", "recovery"]
    };
    return this.#runSuites(groups[group] ?? [group]);
  }

  async #runSuites(keys) {
    const context = createQAContext(this);
    const suites = [];

    for (const key of keys) {
      const fn = TESTS[key];
      if (!fn) continue;
      suites.push(await runSuite(key, fn, context));
    }

    const summary = summarize(suites);
    this.lastReport = {
      system: game.system.id,
      qaModule: "dbz-fuzion-calibrated-qa",
      foundryVersion: game.version,
      systemVersion: game.system.version,
      qaModuleVersion: game.modules.get("dbz-fuzion-calibrated-qa")?.version,
      timestamp: new Date().toISOString(),
      summary,
      suites
    };
    return this.lastReport;
  }

  async cleanupFixtures() {
    const fixtures = dedupeFixtures([...loadTrackedFixtures(), ...this.fixtures]);
    const actors = fixtures.filter(fixture => fixture.documentName === "Actor" && game.actors.has(fixture.id));
    const items = fixtures.filter(fixture => fixture.documentName === "Item" && game.items.has(fixture.id));
    if (actors.length) await Actor.deleteDocuments(actors.map(actor => actor.id));
    if (items.length) await Item.deleteDocuments(items.map(item => item.id));
    this.fixtures = [];
    await saveTrackedFixtures([]);
    return { deletedActors: actors.length, deletedItems: items.length };
  }

  async trackFixture(document) {
    const fixture = {
      documentName: document.documentName,
      id: document.id,
      uuid: document.uuid,
      name: document.name
    };
    this.fixtures = dedupeFixtures([...this.fixtures, fixture]);
    await saveTrackedFixtures(this.fixtures);
  }
}

export function createQAContext(runner) {
  return {
    runner,
    assert(condition, message, details = {}) {
      if (!condition) throw new Error(`${message}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}`);
    },
    // The derived-value suites are written against a 10-point characteristic baseline (Defense 50,
    // max HITs 300, and so on). Set that baseline explicitly rather than inheriting the schema
    // default, so those assertions test the formulas instead of tracking whatever the default is.
    // Pass { bare: true } to get an untouched actor for testing the defaults themselves.
    async createActor(name = "DBZF QA Actor", { bare = false, system = null } = {}) {
      // Set the baseline in the creation payload, not in a follow-up update: _onCreate seeds the
      // Power Up CaC % asynchronously, and a later update races that seed. Creating with
      // caCSeeded already true makes the seed a no-op and keeps these fixtures deterministic.
      // The whole creation-time baseline for a 10/10/10/10 character, exactly as the rules derive
      // it: CaC = Physical + Mental = 20, Battle Power = CaC x 10 = 200. caCSeeded suppresses the
      // _onCreate seed so these stay fixed regardless of what the schema defaults become.
      const baseline = {
        characteristics: {
          physical: { base: 10 }, mental: { base: 10 },
          combat: { base: 10 }, movement: { base: 10 }
        },
        resources: {
          powerUp: { baseCaC: 20, caCSeeded: true },
          battlePower: { value: 200 }
        }
      };
      const payload = system ?? (bare ? null : baseline);
      const actor = await Actor.create({ name, type: "character", ...(payload ? { system: payload } : {}) });
      await runner.trackFixture(actor);
      // _onCreate seeds CaC / Battle Power / HITs in an async update that Foundry does not await,
      // so a fixture relying on those values has to wait for the seed to land.
      if (payload?.resources?.powerUp?.caCSeeded !== true) {
        for (let i = 0; i < 40 && actor.system.resources?.powerUp?.caCSeeded !== true; i++) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
      return actor;
    },
    async createItem(data) {
      const item = await Item.create(data);
      await runner.trackFixture(item);
      return item;
    }
  };
}

async function runSuite(name, fn, context) {
  const tests = [];
  const api = {
    ...context,
    test: async (label, callback) => {
      try {
        await callback();
        tests.push({ name: label, status: "passed" });
      } catch (error) {
        console.error(`DBZ QA failed: ${name} / ${label}`, error);
        tests.push({ name: label, status: "failed", error: error.message });
      }
    },
    skip: label => tests.push({ name: label, status: "skipped" })
  };

  await fn(api);
  const passed = tests.filter(test => test.status === "passed").length;
  const failed = tests.filter(test => test.status === "failed").length;
  const skipped = tests.filter(test => test.status === "skipped").length;
  return { name, passed, failed, skipped, tests };
}

function summarize(suites) {
  return suites.reduce((summary, suite) => {
    summary.passed += suite.passed;
    summary.failed += suite.failed;
    summary.skipped += suite.skipped;
    return summary;
  }, { passed: 0, failed: 0, skipped: 0 });
}

function loadTrackedFixtures() {
  try {
    return game.settings.get(MODULE_ID, FIXTURE_SETTING) ?? [];
  } catch (error) {
    return [];
  }
}

async function saveTrackedFixtures(fixtures) {
  try {
    await game.settings.set(MODULE_ID, FIXTURE_SETTING, dedupeFixtures(fixtures));
  } catch (error) {
    console.warn("DBZ Fuzion Calibrated QA | Could not save fixture tracking state.", error);
  }
}

function dedupeFixtures(fixtures = []) {
  const seen = new Set();
  return fixtures.filter(fixture => {
    const key = `${fixture.documentName}:${fixture.id}`;
    if (!fixture.documentName || !fixture.id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
