export async function runCombatStateTests({ test, assert, createActor }) {
  await test("combat state defaults and spending/reset helpers work", async () => {
    const actor = await createActor();
    assert(actor.system.combatState.actionAvailable === true, "Action should default available");
    assert(actor.system.combatState.reactionAvailable === true, "Reaction should default available");
    assert(actor.system.combatState.phaseCounter === 0, "Phase counter should default 0");
    assert(actor.system.combatState.phasesSinceRecovery === 0, "Recovery counter should default 0");
    assert(await game.dbzf.combatState.spendAction(actor) === true, "spendAction failed");
    assert(actor.system.combatState.actionAvailable === false, "Action not spent");
    assert(await game.dbzf.combatState.spendAction(actor, { warn: false }) === false, "spendAction should fail when unavailable");
    assert(await game.dbzf.combatState.spendReaction(actor) === true, "spendReaction failed");
    assert(actor.system.combatState.reactionAvailable === false, "Reaction not spent");
    assert(await game.dbzf.combatState.spendReaction(actor, { warn: false }) === false, "spendReaction should fail when unavailable");
    await game.dbzf.combatState.resetPhase(actor);
    assert(actor.system.combatState.actionAvailable === true, "Reset did not restore action");
    assert(actor.system.combatState.reactionAvailable === true, "Reset did not restore reaction");
    await game.dbzf.combatState.advancePhase(actor);
    assert(actor.system.combatState.phaseCounter === 1, "Advance did not increment phase");
    assert(actor.system.combatState.phasesSinceRecovery === 1, "Advance did not increment recovery counter");
  });

  await test("boost activation spends resources and expires by phase", async () => {
    const actor = await createActor();
    const [boost] = await actor.createEmbeddedDocuments("Item", [{
      name: "QA Timed Boost",
      type: "boost",
      system: {
        activationCost: "reaction",
        durationPhases: 2,
        showChatOnActivation: false,
        effects: [{ enabled: true, label: "Physical", target: "characteristics.physical.effective", mode: "add", value: 5 }]
      }
    }]);
    await game.dbzf.boosts.activateBoost(actor, boost);
    assert(actor.system.combatState.reactionAvailable === false, "Boost did not spend reaction");
    assert(actor.items.get(boost.id).system.active === true, "Boost did not activate");
    assert(actor.items.get(boost.id).system.remainingPhases === 2, "Boost duration was not set");
    actor.prepareData();
    assert(actor.system.characteristics.physical.effective === 15, "Active boost effect did not apply");
    await game.dbzf.combatState.advancePhase(actor);
    assert(actor.items.get(boost.id).system.remainingPhases === 1, "Boost did not decrement on phase advance");
    await game.dbzf.combatState.advancePhase(actor);
    assert(actor.items.get(boost.id).system.active === false, "Boost did not expire");
  });

  await test("boost activation spends its resolved Ki cost (and aborts if short)", async () => {
    const actor = await createActor("QA Boost Ki Cost");
    await actor.update({ "system.resources.battlePower.value": 1000, "system.resources.ki.value": 100 });
    // BP effective 1000 => 10% + 50 resolves to 150.
    const [boost] = await actor.createEmbeddedDocuments("Item", [{
      name: "QA Costly Boost", type: "boost",
      system: { activationCost: "none", cost: "10% + 50", showChatOnActivation: false }
    }]);
    assert(boost.system.costResolved === 150, "Boost cost should resolve to 150", { actual: boost.system.costResolved });

    // Only 100 charged Ki -> activation must fail and spend nothing.
    const failed = await game.dbzf.boosts.activateBoost(actor, boost);
    assert(failed === null, "Boost should not activate without enough Ki");
    assert(actor.items.get(boost.id).system.active === false, "Boost should stay inactive when Ki is short");
    assert(actor.system.resources.ki.value === 100, "Failed boost activation must not spend Ki", { actual: actor.system.resources.ki.value });

    // Top up and activate -> Ki is deducted.
    await actor.update({ "system.resources.ki.value": 300 });
    await game.dbzf.boosts.activateBoost(actor, actor.items.get(boost.id));
    assert(actor.items.get(boost.id).system.active === true, "Boost should activate with enough Ki");
    assert(actor.system.resources.ki.value === 150, "Boost activation should spend resolved Ki cost (300 - 150)", { actual: actor.system.resources.ki.value });
  });

  await test("indefinite boosts stay active until manually deactivated", async () => {
    const actor = await createActor();
    const [boost] = await actor.createEmbeddedDocuments("Item", [{
      name: "QA Indefinite Boost",
      type: "boost",
      system: {
        activationCost: "none",
        durationPhases: 0,
        showChatOnActivation: false
      }
    }]);
    await game.dbzf.boosts.activateBoost(actor, boost);
    await game.dbzf.combatState.advancePhase(actor);
    await game.dbzf.combatState.advancePhase(actor);
    assert(actor.items.get(boost.id).system.active === true, "Indefinite boost should not expire from phase advancement");
    await game.dbzf.boosts.deactivateBoost(actor, actor.items.get(boost.id));
    assert(actor.items.get(boost.id).system.active === false, "Indefinite boost did not manually deactivate");
  });

  await test("conditions register as Foundry status effects and sync both ways", async () => {
    const ids = (CONFIG.statusEffects ?? []).map(effect => effect.id);
    for (const id of ["dbzfBurn", "dbzfSlow", "dbzfImmobilized", "dbzfSealed"]) {
      assert(ids.includes(id), `CONFIG.statusEffects is missing ${id}`, { actual: ids.join(",") });
    }
    const actor = await createActor("DBZF QA Status");
    await actor.update({ "system.combatState.activeConditions": [] });

    // system condition -> token status
    await game.dbzf.statusEffects.addCondition(actor, { key: "sealed", sourceName: "QA", rating: 2, saveSkill: "mind", saveDC: 20 });
    await new Promise(resolve => setTimeout(resolve, 600));
    let statuses = actor.effects.filter(e => e.statuses?.size).flatMap(e => Array.from(e.statuses));
    assert(statuses.includes("dbzfSealed"), "Sealed condition did not create a token status", { actual: statuses.join(",") });

    // token status -> system condition, with no duplicate effects
    await actor.toggleStatusEffect("dbzfImmobilized", { active: true });
    await new Promise(resolve => setTimeout(resolve, 900));
    statuses = actor.effects.filter(e => e.statuses?.size).flatMap(e => Array.from(e.statuses));
    assert(statuses.length === new Set(statuses).size, "Status sync duplicated effects", { actual: statuses.join(",") });
    const keys = actor.system.combatState.activeConditions.map(c => c.key);
    assert(keys.includes("immobilized"), "Token HUD toggle did not add the system condition", { actual: keys.join(",") });
  });

  await test("Team Attack assists contribute dice and qualities, not just an attack bonus", async () => {
    const fighter = await createActor("DBZF QA Assisted");
    await fighter.update({
      "system.resources.ki.value": 300, "system.resources.ki.charged": 300,
      "system.skills.fighting.rank": 20,
      "system.combatState.pending.teamAttack": [
        { assister: "Ally", label: "Fighting", bonus: 12, techniqueName: "Combo", bonusDice: 7, qualities: "Deadly 2" }
      ]
    });
    const stored = fighter.system.combatState.pending.teamAttack[0];
    assert(stored.bonusDice === 7, "bonusDice must survive the schema", { actual: stored.bonusDice });
    assert(stored.qualities === "Deadly 2", "qualities must survive the schema", { actual: stored.qualities });

    const baseDice = game.dbzf.rollAttack ? null : null;
    await game.dbzf.rollAttack(fighter, "fighting", { attackName: "QA Assisted", consumeAction: false });
    const attack = game.messages.contents.at(-1).getFlag("dbz-fuzion-calibrated", "attack");
    assert(attack.qualityRatings.deadly === 2, "Contributed qualities must reach qualityRatings",
      { actual: attack.qualityRatings.deadly });
    assert((fighter.system.combatState.pending.teamAttack ?? []).length === 0, "Assist should be consumed");
  });
}
