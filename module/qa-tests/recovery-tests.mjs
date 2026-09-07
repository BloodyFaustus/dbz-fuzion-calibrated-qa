export async function runRecoveryTests({ test, assert, createActor }) {
  await test("recovery restores Temp HITs with charged Ki and heals regular HITs", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.ki.charged": 1, "system.resources.tempHits.value": 0, "system.resources.hits.value": 250 });
    await game.dbzf.recoverHits(actor);
    assert(actor.system.resources.tempHits.value === actor.system.resources.tempHits.max, "Temp HITs did not restore");
    assert(actor.system.resources.hits.value === 260, "Regular HITs did not heal by Physical");
  });

  await test("recovery without charged Ki does not restore Temp HITs but heals and caps HITs", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.ki.charged": 0, "system.resources.tempHits.value": 0, "system.resources.hits.value": 295 });
    await game.dbzf.recoverHits(actor);
    assert(actor.system.resources.tempHits.value === 0, "Temp HITs should not restore without charged Ki");
    assert(actor.system.resources.hits.value === 300, "HIT healing should cap at max");
  });

  await test("survival check uses negative HIT DC", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.hits.value": -50 });
    const result = await game.dbzf.rollSurvivalCheck(actor);
    assert(result.dc === 50, "Survival DC should equal absolute negative HITs");
  });

  await test("species recovery and android charge modes apply", async () => {
    const namekian = await createActor("DBZF QA Namekian");
    await namekian.update({ "system.resources.ki.value": 1, "system.resources.ki.charged": 1, "system.resources.hits.value": 250, "system.characteristics.mental.base": 15 });
    await namekian.createEmbeddedDocuments("Item", [{
      name: "QA Dragon Clan",
      type: "species",
      system: { active: true, speciesKey: "namekian", regenerationMode: "namekianDragon" }
    }]);
    await game.dbzf.recoverHits(namekian);
    assert(namekian.system.resources.hits.value === 265, "Dragon Clan recovery should use Mental");

    const android = await createActor("DBZF QA Android");
    await android.createEmbeddedDocuments("Item", [{
      name: "QA Infinite Android",
      type: "species",
      system: { active: true, speciesKey: "android", kiChargeMode: "androidInfinite" }
    }]);
    await game.dbzf.chargeKi(android);
    assert(android.system.resources.ki.charged === 40, "Infinite Android should charge 20% max Ki");
  });

  await test("species regeneration cadence overrides the default 4 phases", async () => {
    // Default with no species: every 4 phases.
    const plain = await createActor("DBZF QA Cadence Plain");
    assert(game.dbzf.recoverySettings(plain).phasesRequired === 4, "Default cadence should be 4 phases", { actual: game.dbzf.recoverySettings(plain).phasesRequired });

    // Namekians regenerate every phase. The shipped species uses regenerationMode "namekian",
    // so the lookup must match it case-insensitively (regression: only "namekianDragon" matched).
    const namekian = await createActor("DBZF QA Cadence Namekian");
    await namekian.createEmbeddedDocuments("Item", [{
      name: "QA Namekian", type: "species",
      system: { active: true, speciesKey: "namekian", regenerationMode: "namekian" }
    }]);
    assert(game.dbzf.recoverySettings(namekian).phasesRequired === 1, "Namekians should regenerate every phase", { actual: game.dbzf.recoverySettings(namekian).phasesRequired });

    // Majin Boo lineage regenerates every 2 phases at 2x Physical.
    const majin = await createActor("DBZF QA Cadence Majin");
    await majin.update({ "system.characteristics.physical.base": 12, "system.resources.hits.value": 100 });
    await majin.createEmbeddedDocuments("Item", [{
      name: "QA Majin", type: "species",
      system: { active: true, speciesKey: "majin", regenerationMode: "majinBoo" }
    }]);
    assert(game.dbzf.recoverySettings(majin).phasesRequired === 2, "Majin Boo lineage should regenerate every 2 phases", { actual: game.dbzf.recoverySettings(majin).phasesRequired });
    const healed = await game.dbzf.recoverHits(majin);
    assert(healed.healed === 24, "Majin Boo regeneration should heal 2x Physical", { actual: healed.healed });

    // A GM can still opt out and use their own cadence.
    await majin.update({ "system.combatState.recovery.useSpeciesPhases": false, "system.combatState.recovery.phasesRequired": 5 });
    assert(game.dbzf.recoverySettings(majin).phasesRequired === 5, "Opting out should restore the manual cadence", { actual: game.dbzf.recoverySettings(majin).phasesRequired });
  });
}
