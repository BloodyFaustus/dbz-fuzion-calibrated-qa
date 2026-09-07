export async function runMigrationTests({ test, assert, createActor }) {
  await test("migration suite loads cleanly", () => {});

  await test("system update preparation does not rewrite existing actor or item source data", async () => {
    const actor = await createActor("DBZF QA Existing Actor");
    const [technique] = await actor.createEmbeddedDocuments("Item", [{
      name: "Existing Technique",
      type: "technique",
      system: {
        description: "<p>Keep this text.</p>",
        boosts: "<p>Keep this boost.</p>",
        kiCostRaw: "10%",
        embeddedQualities: [{ name: "Existing Quality", key: "existing-quality", uuid: "", rating: 2, costKi: true, cost: 0, rulesText: "Keep this quality." }]
      }
    }]);

    const beforeActorSource = foundry.utils.deepClone(actor._source.system);
    const beforeItemSource = foundry.utils.deepClone(technique._source.system);
    actor.prepareData();
    technique.prepareData();

    assert(JSON.stringify(actor._source.system) === JSON.stringify(beforeActorSource), "Actor source data changed during preparation.");
    assert(JSON.stringify(technique._source.system) === JSON.stringify(beforeItemSource), "Item source data changed during preparation.");
    assert(technique.system.description === "<p>Keep this text.</p>", "Technique description changed unexpectedly.");
    assert(technique.system.embeddedQualities[0].name === "Existing Quality", "Embedded quality changed unexpectedly.");
  });

  await test("old-schema item data upgrades safely (trait integer cost, missing boost cost)", async () => {
    const actor = await createActor("DBZF QA Upgrade");
    await actor.update({ "system.resources.battlePower.value": 1000 });

    // Old trait schema stored cost as an integer. The new StringField must accept it without
    // throwing and resolve it (cast "12" -> 12), so updating a live game does not break traits.
    const [trait] = await actor.createEmbeddedDocuments("Item", [{ name: "Legacy Trait", type: "trait", system: { category: "Old", cost: 12 } }]);
    assert(typeof trait.system.cost === "string", "Legacy integer trait cost was not upgraded to string", { type: typeof trait.system.cost });
    assert(trait.system.costResolved === 12, "Legacy trait cost did not resolve", { actual: trait.system.costResolved });

    // Old boost schema had no cost field at all -> must default cleanly.
    const [boost] = await actor.createEmbeddedDocuments("Item", [{ name: "Legacy Boost", type: "boost", system: { activationCost: "action" } }]);
    assert(boost.system.cost === "", "Missing boost cost did not default to empty string", { actual: boost.system.cost });
    assert(boost.system.costResolved === 0, "Missing boost cost did not resolve to 0", { actual: boost.system.costResolved });

    // Old effects had no kiCostResolved field -> must default and not throw.
    const [tech] = await actor.createEmbeddedDocuments("Item", [{ name: "Legacy Effect", type: "technique", system: { effects: [{ enabled: true, label: "x", target: "attacks.all.damageDice", mode: "add", value: 1 }] } }]);
    assert(tech.system.effects[0].kiCostResolved === 0, "Legacy effect kiCostResolved did not default", { actual: tech.system.effects[0].kiCostResolved });
  });

  await test("migration framework: version is stamped and pending-step selection is correct", () => {
    // The world should be stamped at (or past) the current build version after ready.
    const stamped = game.settings.get("dbz-fuzion-calibrated", "lastMigratedVersion");
    assert(!!stamped, "World migration version was not stamped");
    assert(!foundry.utils.isNewerVersion(game.system.version, stamped), "Stamped version is behind the current build", { stamped, current: game.system.version });

    // pendingMigrationVersions picks only steps newer than last and not newer than current.
    const noop = async () => {};
    const registry = { "0.1.22": noop, "0.1.23": noop, "0.2.0": noop };
    const pending = game.dbzf.pendingMigrationVersions("0.1.21", "0.1.23", registry);
    assert(JSON.stringify(pending) === JSON.stringify(["0.1.22", "0.1.23"]), "Pending migration selection wrong", { pending });
    const none = game.dbzf.pendingMigrationVersions("0.1.23", "0.1.23", registry);
    assert(none.length === 0, "Already-current world should have no pending migrations", { none });
  });
}
