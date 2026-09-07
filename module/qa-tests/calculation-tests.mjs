export async function runCalculationTests({ test, assert, createActor }) {
  await test("baseline calculations match target", async () => {
    const actor = await createActor();
    await actor.update({
      "system.characteristics.physical.base": 10,
      "system.characteristics.mental.base": 10,
      "system.characteristics.combat.base": 10,
      "system.characteristics.movement.base": 10,
      "system.experience.total": 0,
      "system.skills.body.rank": 0,
      "system.resources.battlePower.value": 200
    });
    for (const skill of ["fighting", "power", "weapon", "evasion", "mind"]) {
      await actor.update({ [`system.skills.${skill}.rank`]: 0 });
    }

    assert(actor.system.resources.defense.value === 50, "Defense mismatch");
    assert(actor.system.resources.hits.max === 300, "HITs max mismatch");
    assert(actor.system.resources.tempHits.max === 100, "Temp HITs max mismatch");
    assert(actor.system.resources.battlePower.suggested === 200, "Suggested BP mismatch");
    assert(actor.system.resources.battlePower.effective === 200, "Effective BP mismatch");
    assert(actor.system.resources.ki.max === 200, "Ki max mismatch");
    assert(actor.system.resources.powerUp.value === 40, "Power Up mismatch");
    for (const skill of Object.values(actor.system.skills)) assert(skill.total === 10, "Skill total mismatch");
  });

  await test("defense remains five times Physical plus Body rank", async () => {
    const actor = await createActor("QA Defense Regression");
    await actor.update({
      "system.characteristics.physical.base": 12,
      "system.skills.body.rank": 7
    });
    assert(actor.system.resources.defense.value === 67, "Defense formula changed", {
      actual: actor.system.resources.defense.value
    });
  });

  await test("calibrated Battle Power suggestions preserve actual Battle Power", async () => {
    const actor = await createActor("QA BP Calibration");
    await actor.update({
      "system.characteristics.physical.base": 10,
      "system.characteristics.mental.base": 10,
      "system.experience.total": 250,
      "system.resources.battlePower.value": 500,
      "system.powerScaling.battlePowerMode": "manual",
      "system.powerScaling.canonPowerLevel": 1500,
      "system.powerScaling.canonPowerSource": "QA"
    });
    assert(actor.system.powerScaling.strictFormulaBattlePower === 200, "Strict BP diagnostic mismatch");
    assert(actor.system.powerScaling.xpBandSuggestedBattlePower === 4000, "XP-band BP diagnostic mismatch");
    assert(actor.system.resources.battlePower.suggested === 4000, "XP-band suggested BP mismatch");
    assert(actor.system.resources.battlePower.value === 500, "Actual BP was overwritten by diagnostics");

    await actor.update({ "system.powerScaling.battlePowerMode": "strictFormula" });
    assert(actor.system.resources.battlePower.suggested === 200, "Strict Formula mode should suggest strict BP");
    assert(actor.system.resources.battlePower.value === 500, "Strict Formula mode overwrote actual BP");
  });

  await test("hybridCalibration BP mode uses canon, else blends strict and XP band", async () => {
    const actor = await createActor("QA Hybrid BP");
    await actor.update({
      "system.characteristics.physical.base": 10,
      "system.characteristics.mental.base": 10,
      "system.experience.total": 250,
      "system.resources.battlePower.value": 500,
      "system.powerScaling.battlePowerMode": "hybridCalibration"
    });
    // strict = (10+10)*10 = 200; xp band for 250 xp = 4000; no canon => blend = (200+4000)/2 = 2100.
    assert(actor.system.resources.battlePower.suggested === 2100, "Hybrid blend mismatch", { actual: actor.system.resources.battlePower.suggested });
    assert(actor.system.resources.battlePower.value === 500, "Hybrid mode overwrote actual BP");

    // With a canon power level, hybrid anchors to it.
    await actor.update({ "system.powerScaling.canonPowerLevel": 9001 });
    assert(actor.system.resources.battlePower.suggested === 9001, "Hybrid did not anchor to canon", { actual: actor.system.resources.battlePower.suggested });
  });

  await test("derived stats scale off base; effective boosts do not inflate them", async () => {
    const actor = await createActor("QA Base Scaling");
    await actor.update({
      "system.characteristics.physical.base": 10,
      "system.characteristics.mental.base": 10,
      "system.skills.body.rank": 0
    });
    const before = {
      hits: actor.system.resources.hits.max,
      def: actor.system.resources.defense.value,
      temp: actor.system.resources.tempHits.max
    };
    await actor.createEmbeddedDocuments("Item", [{
      name: "QA Effective Buff",
      type: "boost",
      system: { active: true, activationCost: "none", effects: [
        { enabled: true, label: "phys", target: "characteristics.physical.effective", mode: "add", value: 90 },
        { enabled: true, label: "ment", target: "characteristics.mental.effective", mode: "add", value: 90 },
        { enabled: true, label: "body", target: "skills.body.effectiveRank", mode: "add", value: 50 }
      ] }
    }]);
    actor.prepareData();
    assert(actor.system.characteristics.physical.effective === 100, "Effective physical should rise from the boost", { actual: actor.system.characteristics.physical.effective });
    assert(actor.system.resources.hits.max === before.hits, "HITs must not inflate from effective boosts in base form", { before: before.hits, after: actor.system.resources.hits.max });
    assert(actor.system.resources.defense.value === before.def, "Defense must not inflate from effective boosts in base form", { before: before.def, after: actor.system.resources.defense.value });
    assert(actor.system.resources.tempHits.max === before.temp, "Temp HITs must not inflate from effective boosts in base form", { before: before.temp, after: actor.system.resources.tempHits.max });
  });

  await test("derived scaling characteristic and source are configurable", async () => {
    const actor = await createActor("QA Derived Scaling");
    await actor.update({
      "system.characteristics.physical.base": 10,
      "system.characteristics.mental.base": 20,
      "system.skills.body.rank": 0
    });
    assert(actor.system.resources.hits.max === 300, "Default HITs should scale off Physical", { actual: actor.system.resources.hits.max });
    await actor.update({
      "system.derivedScaling.hitsCharacteristic": "mental",
      "system.derivedScaling.defenseCharacteristic": "mental"
    });
    assert(actor.system.resources.hits.max === 500, "HITs should scale off Mental after config (20*20+100)", { actual: actor.system.resources.hits.max });
    assert(actor.system.resources.defense.value === 100, "Defense should scale off Mental after config (5*20)", { actual: actor.system.resources.defense.value });
    // source=effective restores effective-based scaling in base form.
    await actor.update({
      "system.derivedScaling.hitsCharacteristic": "physical",
      "system.derivedScaling.defenseCharacteristic": "physical",
      "system.derivedScaling.source": "effective"
    });
    await actor.createEmbeddedDocuments("Item", [{
      name: "QA Eff Source",
      type: "boost",
      system: { active: true, activationCost: "none", effects: [{ enabled: true, label: "p", target: "characteristics.physical.effective", mode: "add", value: 10 }] }
    }]);
    actor.prepareData();
    assert(actor.system.resources.hits.max === 500, "Effective-source HITs should follow boosted physical (20*20+100)", { actual: actor.system.resources.hits.max });
  });

  await test("Power Up % is the fixed CaC baseline; only effects raise it", async () => {
    const actor = await createActor("QA PowerUp");
    await actor.update({
      "system.characteristics.physical.base": 50,
      "system.characteristics.mental.base": 50,
      "system.resources.battlePower.value": 1000,
      "system.resources.powerUp.baseCaC": 100
    });
    assert(actor.system.resources.powerUp.percent === 100, "Power Up % should equal the CaC baseline", { actual: actor.system.resources.powerUp.percent });
    assert(actor.system.resources.powerUp.value === 1000, "Power Up value = percent/100 * effective BP", { actual: actor.system.resources.powerUp.value });

    // Raising base Physical/Mental must NOT change the % (CaC only).
    await actor.update({ "system.characteristics.physical.base": 90 });
    assert(actor.system.resources.powerUp.percent === 100, "Raising base stats must not change the CaC Power Up %", { actual: actor.system.resources.powerUp.percent });

    // A technique/trait/bonus effect targeting the % DOES raise it.
    await actor.createEmbeddedDocuments("Item", [{ name: "QA PU Trait", type: "trait", system: { active: true, effects: [{ enabled: true, label: "pu", target: "resources.powerUp.percent", mode: "add", value: 25 }] } }]);
    actor.prepareData();
    assert(actor.system.resources.powerUp.percent === 125, "Effects should add to the Power Up % (100 + 25)", { actual: actor.system.resources.powerUp.percent });
    assert(actor.system.resources.powerUp.value === 1250, "Power Up value follows the boosted % (125% of 1000)", { actual: actor.system.resources.powerUp.value });

    // An effective-stat boost must NOT change the %.
    await actor.createEmbeddedDocuments("Item", [{ name: "QA PU Eff", type: "boost", system: { active: true, activationCost: "none", effects: [{ enabled: true, label: "p", target: "characteristics.physical.effective", mode: "add", value: 50 }] } }]);
    actor.prepareData();
    assert(actor.system.resources.powerUp.percent === 125, "Effective-stat boosts must not change the Power Up %", { actual: actor.system.resources.powerUp.percent });
  });

  await test("effect values can be stat formulas like 15%(evasion)", async () => {
    const actor = await createActor("QA Value Formula");
    await actor.update({
      "system.characteristics.physical.base": 10,
      "system.characteristics.combat.base": 20,
      "system.skills.evasion.rank": 30,
      "system.resources.battlePower.value": 1000
    });
    // Evasion total = rank 30 + Combat 20 = 50.
    assert(actor.system.skills.evasion.total === 50, "Evasion total setup mismatch", { actual: actor.system.skills.evasion.total });

    const [buff] = await actor.createEmbeddedDocuments("Item", [{
      name: "QA Formula Trait",
      type: "trait",
      system: { active: true, effects: [
        // 15% of Evasion (50) = 8 (rounded), added to Defense.
        { enabled: true, label: "eva share", target: "resources.defense.value", mode: "add", value: 0, valueFormula: "15%(evasion)" }
      ] }
    }]);
    actor.prepareData();
    assert(actor.system.resources.defense.value === 58, "15%(evasion) should add 8 to Defense (50 base + 8)", { actual: actor.system.resources.defense.value });
    assert(buff.system.effects[0].valueResolved === 8, "Resolved formula value should be exposed for display", { actual: buff.system.effects[0].valueResolved });

    // A bare reference uses the whole stat; a bare percent reads Battle Power.
    await buff.update({ "system.effects": [{ enabled: true, label: "full eva", target: "resources.defense.value", mode: "add", value: 0, valueFormula: "evasion" }] });
    actor.prepareData();
    assert(actor.system.resources.defense.value === 100, "Bare skill reference should add the full Evasion total", { actual: actor.system.resources.defense.value });

    await buff.update({ "system.effects": [{ enabled: true, label: "bp share", target: "resources.defense.value", mode: "add", value: 0, valueFormula: "5%" }] });
    actor.prepareData();
    assert(actor.system.resources.defense.value === 100, "Bare percent should read Battle Power (5% of 1000 = 50)", { actual: actor.system.resources.defense.value });

    // Combined terms, and the plain Value column still works when no formula is set.
    await buff.update({ "system.effects": [{ enabled: true, label: "combo", target: "resources.defense.value", mode: "add", value: 999, valueFormula: "10%(evasion) + physical - 2" }] });
    actor.prepareData();
    assert(actor.system.resources.defense.value === 63, "Combined formula should be 5 + 10 - 2 = 13 (50 + 13)", { actual: actor.system.resources.defense.value });
  });

  await test("XP/BP band interpolation APIs match calibration table", () => {
    assert(game.dbzf.xpFromBattlePower(750) === 50, "BP 750 XP mismatch");
    assert(game.dbzf.xpFromBattlePower(4000) === 250, "BP 4000 XP mismatch");
    assert(game.dbzf.battlePowerFromXp(250) === 4000, "XP 250 BP mismatch");
    const midXp = game.dbzf.xpFromBattlePower(1500);
    assert(midXp > 100 && midXp < 150, "BP 1500 should interpolate between 100 and 150 XP", { midXp });
    const midBp = game.dbzf.battlePowerFromXp(125);
    assert(midBp > 1250 && midBp < 1750, "XP 125 should interpolate between 1250 and 1750 BP", { midBp });
    assert(game.dbzf.roundBattlePowerSuggestion(3655000) === 3600000, "Two-significant-digit BP rounding mismatch");
    assert(game.dbzf.roundBattlePowerSuggestion(108000000) === 100000000, "Large BP rounding mismatch");
  });

  await test("Max Ki and effective Battle Power are both usable effect targets", async () => {
    const actor = await createActor("DBZF QA KiMax");
    const baseMax = actor.system.resources.ki.max;
    const [boost] = await actor.createEmbeddedDocuments("Item", [{ name: "QA MaxKi", type: "boost", system: {
      active: true, activationCost: "none",
      effects: [{ enabled: true, label: "Max Ki", target: "resources.ki.max", mode: "add", value: 500, valueFormula: "", kiCostRaw: "", rulesText: "" }] } }]);
    actor.prepareData();
    assert(actor.system.resources.ki.max === baseMax + 500,
      "A Boost targeting Max Ki must raise the cap", { actual: actor.system.resources.ki.max, baseMax });

    await boost.update({ "system.effects": [{ enabled: true, label: "BP", target: "resources.battlePower.effective", mode: "add", value: 800, valueFormula: "", kiCostRaw: "", rulesText: "" }] });
    actor.prepareData();
    assert(actor.system.resources.ki.max === actor.system.resources.battlePower.effective,
      "Raising effective Battle Power must raise Max Ki with it",
      { kiMax: actor.system.resources.ki.max, bp: actor.system.resources.battlePower.effective });
  });

  await test("effect formulas can read current Ki and total HITs", async () => {
    const actor = await createActor("DBZF QA Vars");
    await actor.update({ "system.resources.ki.value": 120, "system.resources.hits.value": 210 });
    const sys = actor.system;
    const read = formula => game.dbzf.resolveValueFormula(formula, sys);
    assert(read("currentKi") === 120, "currentKi should be charged Ki", { actual: read("currentKi") });
    assert(read("ki") === 120, "ki should be charged Ki", { actual: read("ki") });
    assert(read("maxKi") === sys.resources.ki.max, "maxKi should be the cap", { actual: read("maxKi") });
    assert(read("hits") === 210, "hits should be CURRENT HITs", { actual: read("hits") });
    assert(read("hitsTotal") === sys.resources.hits.max, "hitsTotal should be MAX HITs", { actual: read("hitsTotal") });
    assert(read("maxHits") === sys.resources.hits.max, "maxHits should alias hitsTotal", { actual: read("maxHits") });
    // The High Tension case: heal half of total HITs.
    assert(read("50%(hitsTotal)") === Math.round(sys.resources.hits.max / 2),
      "A percentage of hitsTotal should resolve", { actual: read("50%(hitsTotal)") });
  });
}
