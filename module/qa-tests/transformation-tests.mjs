export async function runTransformationTests({ test, assert, createActor }) {
  await test("transformations do not mutate or stack base values", async () => {
    const actor = await createActor();
    await actor.update({
      "system.characteristics.physical.base": 10,
      "system.characteristics.mental.base": 10,
      "system.characteristics.combat.base": 10,
      "system.characteristics.movement.base": 10,
      "system.skills.fighting.rank": 10,
      "system.skills.body.rank": 10,
      "system.resources.battlePower.value": 200
    });

    await actor.update({ "system.transformation.selected": "kaiokenx2" });
    const first = actor.system.characteristics.physical.effective;
    assert(actor.system.characteristics.physical.base === 10, "Base physical mutated");
    await actor.update({ "system.transformation.selected": "kaiokenx2" });
    assert(actor.system.characteristics.physical.effective === first, "Repeated transform stacked");

    await actor.update({ "system.transformation.selected": "kaiokenx3" });
    assert(actor.system.characteristics.physical.effective === 25, "Switch did not recalc from base");

    await actor.update({ "system.characteristics.physical.base": 12 });
    assert(actor.system.characteristics.physical.effective === 30, "Edit while transformed did not recalc");

    await actor.update({ "system.transformation.selected": "base" });
    assert(actor.system.characteristics.physical.base === 12, "Edited base did not persist");
    assert(actor.system.characteristics.physical.effective === 12, "Base did not restore effective");
  });

  await test("kaioken x2 acceptance values", async () => {
    const actor = await createActor();
    await actor.update({
      "system.characteristics.physical.base": 10,
      "system.characteristics.mental.base": 10,
      "system.characteristics.combat.base": 10,
      "system.characteristics.movement.base": 10,
      "system.skills.body.rank": 10,
      "system.skills.fighting.rank": 10,
      "system.skills.power.rank": 10,
      "system.skills.mind.rank": 10,
      "system.resources.battlePower.value": 200,
      "system.transformation.selected": "kaiokenx2"
    });
    assert(actor.system.characteristics.physical.effective === 20, "Kaioken physical mismatch");
    assert(actor.system.characteristics.movement.effective === 13, "Kaioken movement mismatch");
    assert(actor.system.skills.fighting.effectiveRank === 20, "Kaioken fighting rank mismatch");
    assert(actor.system.skills.power.effectiveRank === 15, "Kaioken power rank mismatch");
    assert(actor.system.skills.body.effectiveRank === 13, "Kaioken body rank mismatch");
    assert(actor.system.skills.mind.effectiveRank === 8, "Kaioken mind rank mismatch");
    assert(actor.system.resources.battlePower.effective === 400, "Kaioken effective BP mismatch");
    assert(actor.system.resources.ki.max === 400, "Kaioken max Ki mismatch");
    assert(actor.system.resources.powerUp.value === 80, "Kaioken power up mismatch");
    assert(actor.system.resources.defense.value === 60, "Kaioken defense should use base");
    assert(actor.system.resources.hits.max === 310, "Kaioken HITs should use base");
  });

  await test("oozaru and giant namekian direct HIT and Defense modes", async () => {
    const actor = await createActor();
    await actor.update({
      "system.characteristics.physical.base": 10,
      "system.characteristics.mental.base": 10,
      "system.characteristics.combat.base": 10,
      "system.characteristics.movement.base": 10,
      "system.skills.body.rank": 10,
      "system.resources.battlePower.value": 200,
      "system.transformation.selected": "oozaru"
    });
    assert(actor.system.resources.battlePower.effective === 500, "Oozaru effective BP mismatch");
    assert(actor.system.resources.defense.value === 90, "Oozaru direct defense mismatch");
    assert(actor.system.resources.hits.max === 465, "Oozaru direct HITs mismatch");

    await actor.update({ "system.transformation.selected": "giantNamekian" });
    assert(actor.system.resources.battlePower.effective === 100, "Giant Namekian effective BP mismatch");
    assert(actor.system.resources.defense.value === 150, "Giant Namekian direct defense mismatch");
    assert(actor.system.resources.hits.max === 930, "Giant Namekian direct HITs mismatch");
  });

  await test("transformation HIT delta can drive main HITs negative", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.hits.value": 100, "system.transformation.selected": "oozaru" });
    assert(actor.system.resources.hits.value === 250, "Entering direct HIT form did not restore gained max HITs", { actual: actor.system.resources.hits.value });
    assert(actor.system.resources.hits.transformationBonusApplied === 150, "Transformation bonus not tracked");
    await actor.update({ "system.resources.hits.value": 50 });
    await actor.update({ "system.transformation.selected": "base" });
    assert(actor.system.resources.hits.value === -100, "Exiting form did not remove transformed HIT bonus into negatives", { actual: actor.system.resources.hits.value });
    assert(actor.system.resources.hits.transformationBonusApplied === 0, "Transformation bonus not cleared");
  });

  await test("direct-to-direct transformation switch applies only net HIT delta", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.hits.value": 100, "system.transformation.selected": "oozaru" });
    assert(actor.system.resources.hits.value === 250, "Initial direct transform delta failed", { actual: actor.system.resources.hits.value });
    // Oozaru bonus 150 -> Monster Form bonus 300, so only the +150 net delta is applied.
    await actor.update({ "system.transformation.selected": "monsterForm" });
    assert(actor.system.resources.hits.value === 400, "Direct-to-direct switch should apply only the net delta", { actual: actor.system.resources.hits.value });
    assert(actor.system.resources.hits.transformationBonusApplied === 300, "Direct-to-direct bonus tracking mismatch");
  });

  await test("Saiyan Rage heals half the HIT total instead of raising maximum HITs", async () => {
    const actor = await createActor("QA Saiyan Rage");
    await actor.update({ "system.resources.hits.value": 100, "system.transformation.selected": "saiyanRage" });
    assert(actor.system.resources.hits.max === 300, "Saiyan Rage must not raise maximum HITs", { actual: actor.system.resources.hits.max });
    assert(actor.system.resources.defense.value === 50, "Saiyan Rage must not raise Defense", { actual: actor.system.resources.defense.value });
    assert(actor.system.resources.hits.value === 250, "Saiyan Rage should heal 50% of the HIT total (100 + 150)", { actual: actor.system.resources.hits.value });
    assert(actor.system.resources.hits.transformationBonusApplied === 0, "Saiyan Rage grants no max-HIT bonus", { actual: actor.system.resources.hits.transformationBonusApplied });
    // The heal cannot overheal past maximum HITs.
    await actor.update({ "system.transformation.selected": "base" });
    await actor.update({ "system.resources.hits.value": 280 });
    await actor.update({ "system.transformation.selected": "saiyanRage" });
    assert(actor.system.resources.hits.value === 300, "Saiyan Rage heal should clamp at maximum HITs", { actual: actor.system.resources.hits.value });
    // Leaving the form keeps the healed HITs (nothing was borrowed from a raised maximum).
    await actor.update({ "system.transformation.selected": "base" });
    assert(actor.system.resources.hits.value === 300, "Leaving Saiyan Rage should not remove healed HITs", { actual: actor.system.resources.hits.value });
  });

  await test("getRollData does not corrupt live derived data (transformation persists after acting)", async () => {
    // Regression for the root-cause bug: getRollData() merged a SOURCE copy over the live
    // system, overwriting transformation-boosted derived values with stale source values
    // every time a chat card or roll was built — so transformations "reverted" after acting.
    const actor = await createActor("QA RollData");
    await actor.update({
      "system.characteristics.physical.base": 10,
      "system.resources.battlePower.value": 200,
      "system.transformation.selected": "kaiokenx2"
    });
    assert(actor.system.characteristics.physical.effective === 20, "Pre-roll transform effective wrong");

    // getRollData must NOT mutate the live document, and must expose derived values.
    const rollData = actor.getRollData();
    assert(rollData.characteristics.physical.effective === 20, "Roll data should carry derived effective", { actual: rollData.characteristics.physical.effective });
    assert(actor.system.characteristics.physical.effective === 20, "getRollData corrupted live derived effective", { actual: actor.system.characteristics.physical.effective });

    // A chat message with an actor speaker invokes getRollData during render; derived data must survive.
    const msg = await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: "<p>qa rolldata</p>" });
    assert(actor.system.characteristics.physical.effective === 20, "Chat card creation reverted transformation", { actual: actor.system.characteristics.physical.effective });
    assert(actor.system.resources.battlePower.effective === 400, "Chat card creation reverted effective BP", { actual: actor.system.resources.battlePower.effective });
    await msg.delete();
    await actor.delete();
  });

  await test("SSJ3 exit drains charged Ki", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.ki.charged": 200, "system.transformation.selected": "superSaiyan3" });
    await actor.update({ "system.transformation.selected": "base" });
    assert(actor.system.resources.ki.charged === 0, "SSJ3 exit did not drain charged Ki");
  });
}
