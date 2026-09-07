export async function runSheetInteractionTests({ test, assert, createActor, createItem }) {
  await test("actor fields save and derived values update", async () => {
    const actor = await createActor();
    await actor.update({ "system.characteristics.physical.base": 12 });
    assert(actor.system.characteristics.physical.base === 12, "Physical did not save");
    assert(actor.system.resources.defense.value === 60, "Derived defense did not update");
  });

  await test("owned item data persists and can be embedded", async () => {
    const actor = await createActor();
    const weapon = await createItem({ name: "QA Weapon", type: "weapon", system: { damageDice: 9, qualities: "QA" } });
    const data = weapon.toObject();
    delete data._id;
    const [owned] = await actor.createEmbeddedDocuments("Item", [data]);
    assert(owned.type === "weapon", "Owned weapon type mismatch");
    assert(owned.system.damageDice === 9, "Owned weapon damage did not persist");
    await owned.update({ "system.damageDice": 11 });
    assert(actor.items.get(owned.id).system.damageDice === 11, "Owned weapon update did not persist");
  });

  await test("active owned item effects update actor derived data", async () => {
    const actor = await createActor();
    const [technique] = await actor.createEmbeddedDocuments("Item", [{
      name: "QA HIT Modifier",
      type: "technique",
      system: {
        active: true,
        effects: [{ enabled: true, label: "Half HITs", target: "resources.hits.max", mode: "multiply", value: 0.5, kiCostRaw: "", rulesText: "" }]
      }
    }]);
    assert(technique.system.active === true, "Technique did not become active");
    actor.prepareData();
    assert(actor.system.resources.hits.max === 150, "Active item effect did not modify HITs max", { actual: actor.system.resources.hits.max });
  });

  await test("active species effects update actor derived data", async () => {
    const actor = await createActor();
    await actor.createEmbeddedDocuments("Item", [{
      name: "QA Species",
      type: "species",
      system: {
        active: true,
        traits: "QA Trait",
        effects: [{ enabled: true, label: "Species Physical", target: "characteristics.physical.effective", mode: "add", value: 5, kiCostRaw: "", rulesText: "" }]
      }
    }]);
    actor.prepareData();
    assert(actor.system.characteristics.physical.effective === 15, "Active species effect did not apply");
  });

  await test("starter armor effect applies defense", async () => {
    const actor = await createActor();
    const armor = foundry.utils.deepClone(game.dbzf.starterContent.sampleItems.find(item => item.name === "Weighted Armor"));
    armor.system.active = true;
    await actor.createEmbeddedDocuments("Item", [armor]);
    actor.prepareData();
    assert(actor.system.resources.defense.value === 52, "Starter armor defense effect did not apply", { actual: actor.system.resources.defense.value });
    // Armor HP is a separate absorbing layer now, so it does not inflate max HITs.
    assert(actor.system.resources.hits.max === 300, "Armor HP should not change max HITs", { actual: actor.system.resources.hits.max });
  });

  await test("armor defense bonus applies without duplicate effect", async () => {
    const actor = await createActor();
    await actor.createEmbeddedDocuments("Item", [{
      name: "QA Armor",
      type: "armor",
      system: { active: true, defenseBonus: 3, bonusHits: 12, currentHits: 12, destroyed: false, effects: [] }
    }]);
    actor.prepareData();
    assert(actor.system.resources.defense.value === 53, "Armor defenseBonus did not apply intrinsically", { actual: actor.system.resources.defense.value });
    // Armor HP is a separate absorbing layer, not part of max HITs.
    assert(actor.system.resources.hits.max === 300, "Armor HP should not change max HITs", { actual: actor.system.resources.hits.max });
  });

  await test("destroyed armor does not apply bonuses", async () => {
    const actor = await createActor();
    await actor.createEmbeddedDocuments("Item", [{
      name: "Destroyed Armor",
      type: "armor",
      system: { active: true, destroyed: true, defenseBonus: 20, bonusHits: 80, currentHits: 0, effects: [] }
    }]);
    actor.prepareData();
    assert(actor.system.resources.defense.value === 50, "Destroyed armor defense should not apply", { actual: actor.system.resources.defense.value });
    assert(actor.system.resources.hits.max === 300, "Destroyed armor HITs should not apply", { actual: actor.system.resources.hits.max });
  });

  await test("charged Ki can stay at zero when previous charged value existed", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.ki.value": 0, "system.resources.ki.charged": 100 });
    actor.prepareData();
    assert(actor.system.resources.ki.value === 0, "Ki value resurrected from stale charged value", { value: actor.system.resources.ki.value });
    assert(actor.system.resources.ki.charged === 0, "Charged Ki did not sync to canonical value", { charged: actor.system.resources.ki.charged });
  });

  await test("charge Ki consumes action and clamps at max", async () => {
    const actor = await createActor();
    await actor.update({
      "system.resources.ki.value": 0,
      "system.resources.ki.charged": 0,
      "system.characteristics.physical.base": 10,
      "system.characteristics.mental.base": 10
    });
    await game.dbzf.chargeKi(actor);
    assert(actor.system.resources.ki.charged === 40, "Charge Ki did not add Power Up value", { actual: actor.system.resources.ki.charged });
    assert(actor.system.combatState.actionAvailable === false, "Charge Ki did not consume action");
    const refused = await game.dbzf.chargeKi(actor);
    assert(refused === null, "Charge Ki should fail without action");
    assert(actor.system.resources.ki.charged === 40, "Failed charge changed Ki");
    await game.dbzf.combatState.resetPhase(actor);
    await actor.update({ "system.resources.ki.value": 190, "system.resources.ki.charged": 190 });
    await game.dbzf.chargeKi(actor);
    assert(actor.system.resources.ki.charged === 200, "Charge Ki did not clamp at max Ki", { actual: actor.system.resources.ki.charged });
  });

  await test("charged Ki is a token bar resource shape", async () => {
    const actor = await createActor();
    assert(game.system.primaryTokenAttribute === "resources.hits", "Primary token bar changed unexpectedly");
    assert(game.system.secondaryTokenAttribute === "resources.ki", "Secondary token bar should default to charged Ki");
    assert(CONFIG.Actor.trackableAttributes.character.bar.includes("resources.ki"), "Charged Ki not trackable as token bar");
    assert("value" in actor.system.resources.ki && "max" in actor.system.resources.ki, "Ki resource lacks value/max shape");
  });

  await test("Current HITs heal effect resolves on a trait and spends its Ki cost", async () => {
    const actor = await createActor("QA Trait Heal");
    await actor.update({
      "system.characteristics.physical.base": 50,
      "system.resources.battlePower.value": 1000,
      "system.resources.ki.value": 1000,
      "system.resources.hits.value": 200
    });
    const [trait] = await actor.createEmbeddedDocuments("Item", [{
      name: "QA Regen Trait",
      type: "trait",
      system: { active: true, effects: [{ enabled: true, label: "Saisei", target: "resources.hits.value", mode: "add", value: 100, kiCostRaw: "1%" }] }
    }]);
    actor.prepareData();
    assert(trait.system.effects[0].kiCostResolved === 10, "1% of BP 1000 should resolve to 10 Ki", { actual: trait.system.effects[0].kiCostResolved });
    const hitsBefore = actor.system.resources.hits.value;
    const kiBefore = actor.system.resources.ki.value;
    const healed = await game.dbzf.boosts.applyItemInstantHeals(actor, trait);
    assert(healed.length > 0, "Trait heal should resolve", { healed });
    assert(actor.system.resources.hits.value === hitsBefore + 100, "Current HITs should heal by 100", { before: hitsBefore, after: actor.system.resources.hits.value });
    assert(actor.system.resources.ki.value === kiBefore - 10, "Should spend the effect's 1% Ki cost", { before: kiBefore, after: actor.system.resources.ki.value });
  });
}
