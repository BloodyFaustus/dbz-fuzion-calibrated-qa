export async function runDataModelTests({ test, assert, createActor, createItem }) {
  await test("character actor can be created", async () => {
    const actor = await createActor();
    assert(actor.type === "character", "Actor type mismatch");
  });

  await test("a new character seeds CaC, Battle Power and HITs from the rules formulas", async () => {
    const actor = await createActor("DBZF QA Seed", { system: {
      characteristics: { physical: { base: 14 }, mental: { base: 11 } },
      skills: { body: { rank: 12 } },
      experience: { total: 100 }
    } });
    const r = actor.system.resources;
    // CaC % = starting Physical + Mental
    assert(r.powerUp.baseCaC === 25, "CaC should be Physical + Mental", { actual: r.powerUp.baseCaC });
    // Battle Power / Ki Capacity = (Physical + Mental) x 10 = CaC x 10
    assert(r.battlePower.value === 250, "Battle Power should be CaC x 10", { actual: r.battlePower.value });
    assert(r.ki.max === 250, "Ki capacity should equal Battle Power", { actual: r.ki.max });
    // HITs = (20 x Physical) + (3 x EXP) + 100 + Body ranks
    const expectedHits = (20 * 14) + (3 * 100) + 100 + 12;
    assert(r.hits.max === expectedHits, "Max HITs should follow the formula", { actual: r.hits.max, expected: expectedHits });
    assert(r.hits.value === expectedHits, "A new character should start at full HITs", { actual: r.hits.value });
  });

  await test("creation seeding never re-runs on an already-seeded character", async () => {
    const actor = await createActor("DBZF QA Reseed", { system: {
      characteristics: { physical: { base: 8 }, mental: { base: 8 } }
    } });
    // Raising stats after creation must not move the locked starting figures.
    await actor.update({ "system.characteristics.physical.base": 40, "system.characteristics.mental.base": 40 });
    assert(actor.system.resources.powerUp.baseCaC === 16, "CaC must stay locked at its creation value",
      { actual: actor.system.resources.powerUp.baseCaC });
    assert(actor.system.resources.battlePower.value === 160, "Battle Power must stay locked at its creation value",
      { actual: actor.system.resources.battlePower.value });
    // Max HITs is derived, so it does follow the raised stats.
    assert(actor.system.resources.hits.max === (20 * 40) + 100, "Max HITs should follow current Physical",
      { actual: actor.system.resources.hits.max });
  });

  await test("a new character starts with every characteristic at 1", async () => {
    const actor = await createActor("DBZF QA Defaults", { bare: true });
    for (const key of ["physical", "mental", "combat", "movement"]) {
      assert(actor.system.characteristics[key].base === 1, `Default ${key} base should be 1`,
        { actual: actor.system.characteristics[key].base });
      assert(actor.system.characteristics[key].effective === 1, `Default ${key} effective should be 1`,
        { actual: actor.system.characteristics[key].effective });
    }
  });

  await test("all item types can be created and persist system data", async () => {
    const cases = [
      { type: "technique", system: { kiCostRaw: "25%+10", extraDice: 2, upgradeCount: 3 } },
      { type: "weapon", system: { damageDice: 7, qualities: "Sharp" } },
      { type: "armor", system: { defenseBonus: 3, qualities: "Heavy" } },
      { type: "equipment", system: { quantity: 2, category: "Gear" } },
      { type: "quality", system: { rating: 1, cost: 5 } },
      { type: "transformation", system: { cost: "10", duration: "Scene" } },
      { type: "species", system: { traits: "Test Trait" } },
      { type: "trait", system: { category: "Test", cost: "10%", upgradeCount: 2 } },
      { type: "boost", system: { activationCost: "reaction", durationPhases: 2, showChatOnActivation: true, cost: "5", upgradeCount: 5 } },
      { type: "consumable", system: { quantity: 4, activation: "Action" } }
    ];
    for (const itemData of cases) {
      const item = await createItem({ name: `QA ${itemData.type}`, type: itemData.type, system: itemData.system });
      for (const [key, value] of Object.entries(itemData.system)) {
        assert(item.system[key] === value, `${itemData.type}.${key} did not persist`, { actual: item.system[key], expected: value });
      }
    }
  });

  await test("effect rows and embedded qualities persist", async () => {
    const quality = await createItem({ name: "QA Quality", type: "quality", system: { rating: 2, rulesText: "QA" } });
    const technique = await createItem({
      name: "QA Technique Effects",
      type: "technique",
      system: {
        active: true,
        effects: [{ enabled: true, label: "Damage Boost", target: "attacks.all.damageDice", mode: "add", value: 50, kiCostRaw: "10", rulesText: "QA" }],
        embeddedQualities: [{ name: quality.name, uuid: quality.uuid, rating: quality.system.rating, rulesText: quality.system.rulesText }]
      }
    });
    assert(technique.system.effects[0].value === 50, "Effect row value did not persist");
    assert(technique.system.embeddedQualities[0].name === "QA Quality", "Embedded quality did not persist");
    await technique.update({
      "system.effects": [{
        enabled: true,
        label: "Changed Target",
        target: "attacks.body.damageDice",
        mode: "percent",
        value: 25,
        kiCostRaw: "5",
        rulesText: "QA changed"
      }]
    });
    assert(technique.system.effects[0].target === "attacks.body.damageDice", "Effect target dropdown value did not persist");
    assert(technique.system.effects[0].mode === "percent", "Effect mode dropdown value did not persist");
    assert(technique.system.effects[0].value === 25, "Effect value reset after dropdown change");
  });

  await test("effect target coverage includes core sheet and attack targets", async () => {
    const targets = game.dbzf.effectTargets.map(target => target.key);
    for (const expected of [
      "attacks.body.damageDice",
      "attacks.custom.damageDice",
      // Evasion and Mind are live ATTACK_CONFIG attack types, so their damage-dice
      // targets are handled by getActiveAttackBonusDice and must be offered.
      "attacks.evasion.damageDice",
      "attacks.mind.damageDice",
      "characteristics.physical.effective",
      "characteristics.all.effective",
      "skills.body.effectiveRank",
      "skills.all.effectiveRank",
      "customSkills.all.effectiveRank",
      "resources.powerUp.percent",
      // Current HIT / Temp HIT values are live: a boost effect targeting them applies a
      // one-time heal on activation (see boosts.applyBoostInstantHeals).
      "resources.hits.value",
      "resources.tempHits.value",
      "experience.total",
      "finances.zeni"
    ]) {
      assert(targets.includes(expected), `Missing effect target ${expected}`);
    }
    // These reference attack types that do not exist (no ATTACK_CONFIG),
    // so they must NOT be offered as effect targets.
    for (const dead of ["attacks.telekinesis.damageDice", "attacks.magic.damageDice"]) {
      assert(!targets.includes(dead), `Dead effect target should not be exposed: ${dead}`);
    }
    // Ki max/charged are always recomputed from Battle Power after effects, so exposing
    // them as effect targets would do nothing; they must stay unlisted.
    for (const inert of ["resources.ki.max", "resources.ki.charged"]) {
      assert(!targets.includes(inert), `Inert effect target should not be exposed: ${inert}`);
    }
  });

  await test("boost/trait/effect costs resolve raw numbers and %-of-BP", async () => {
    const actor = await createActor("QA Cost Parsing");
    // BP effective is 200 at defaults => 10% of 200 = 20.
    assert(actor.system.resources.battlePower.effective === 200, "Unexpected baseline BP", { bp: actor.system.resources.battlePower.effective });

    const boost = await actor.createEmbeddedDocuments("Item", [{ name: "QA Boost Cost", type: "boost", system: { cost: "10% + 5" } }]).then(r => r[0]);
    assert(boost.system.cost === "10% + 5", "Boost cost raw did not persist", { actual: boost.system.cost });
    assert(boost.system.costResolved === 25, "Boost cost did not resolve to 25", { actual: boost.system.costResolved });

    const trait = await actor.createEmbeddedDocuments("Item", [{ name: "QA Trait Cost", type: "trait", system: { cost: "25%" } }]).then(r => r[0]);
    assert(trait.system.costResolved === 50, "Trait cost did not resolve to 50", { actual: trait.system.costResolved });

    const tech = await actor.createEmbeddedDocuments("Item", [{ name: "QA Effect Cost", type: "technique", system: { effects: [{ enabled: true, label: "x", target: "attacks.all.damageDice", mode: "add", value: 1, kiCostRaw: "5%" }] } }]).then(r => r[0]);
    assert(tech.system.effects[0].kiCostRaw === "5%", "Effect kiCostRaw did not persist", { actual: tech.system.effects[0].kiCostRaw });
    assert(tech.system.effects[0].kiCostResolved === 10, "Effect ki cost did not resolve to 10", { actual: tech.system.effects[0].kiCostResolved });

    // %-of-BP costs must re-resolve when the owner's Battle Power changes (regression:
    // item costs were resolved during item prep, before the actor's effective BP existed).
    await actor.update({ "system.resources.battlePower.value": 1000 });
    assert(boost.system.costResolved === 105, "Boost cost did not re-resolve after BP change (10% of 1000 + 5)", { actual: boost.system.costResolved });
    assert(trait.system.costResolved === 250, "Trait cost did not re-resolve after BP change (25% of 1000)", { actual: trait.system.costResolved });
    assert(tech.system.effects[0].kiCostResolved === 50, "Effect cost did not re-resolve after BP change (5% of 1000)", { actual: tech.system.effects[0].kiCostResolved });

    await actor.delete();
  });
}
