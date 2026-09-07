export async function runReactionTests({ test, assert, createActor }) {
  await test("All Out consumes reaction and affects next attack", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.ki.charged": 200 });
    await game.dbzf.reactions.rollAllOut(actor);
    assert(actor.system.combatState.reactionAvailable === false, "All Out did not spend reaction");
    assert(actor.system.combatState.pending.allOut === true, "All Out pending flag missing");
    const result = await game.dbzf.rollAttack(actor, "fighting", { consumeAction: false });
    assert(result.attackRoll.formula.includes("+ 1"), "All Out attack bonus missing", { formula: result.attackRoll.formula });
    assert(actor.system.combatState.pending.allOut === false, "All Out did not clear");
  });

  await test("Quick Charge and combined charge consume resources and clamp", async () => {
    const actor = await createActor();
    await game.dbzf.reactions.rollQuickCharge(actor);
    assert(actor.system.combatState.reactionAvailable === false, "Quick Charge did not spend reaction");
    assert(actor.system.resources.ki.charged === 20, "Quick Charge should add half Power Up");
    await game.dbzf.combatState.resetPhase(actor);
    await game.dbzf.reactions.rollQuickCharge(actor, { combined: true });
    assert(actor.system.combatState.actionAvailable === false, "Combined charge did not spend action");
    assert(actor.system.combatState.reactionAvailable === false, "Combined charge did not spend reaction");
    assert(actor.system.resources.ki.charged === 80, "Combined charge should add 1.5x Power Up");
  });

  await test("Block Deflect and Ki Barrier consume reactions", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.ki.charged": 200 });
    assert(await game.dbzf.reactions.rollBlock(actor), "Block failed");
    await game.dbzf.combatState.resetPhase(actor);
    assert(await game.dbzf.reactions.rollDeflect(actor), "Deflect failed");
    await game.dbzf.combatState.resetPhase(actor);
    const barrier = await game.dbzf.reactions.rollKiBarrier(actor, { dice: 99, incomingDamageDice: 5 });
    assert(!!barrier, "Ki Barrier failed");
    assert(actor.system.resources.ki.charged === 150, "Ki Barrier should clamp to incoming 5 dice and spend 50 Ki", { charged: actor.system.resources.ki.charged });
  });

  await test("Ki Barrier reduces a specific incoming attack and records the application", async () => {
    const attacker = await createActor("QA Barrier Attacker");
    await attacker.update({
      "system.characteristics.physical.base": 10,
      "system.skills.fighting.rank": 20,
      "system.resources.battlePower.value": 1000,
      "system.resources.ki.value": 500
    });
    await game.dbzf.combatState.resetPhase(attacker);
    await game.dbzf.rollAttack(attacker, "fighting", { consumeAction: false });
    const message = game.messages.contents.at(-1);
    const attack = message.getFlag("dbz-fuzion-calibrated", "attack");
    assert(attack.damageDice === 30, "Attack flags should record the damage dice count", { actual: attack.damageDice });

    const defender = await createActor("QA Barrier Defender");
    await defender.update({
      "system.characteristics.mental.base": 30,
      "system.skills.power.rank": 30,
      "system.skills.mind.rank": 30,
      "system.resources.battlePower.value": 5000,
      "system.resources.ki.value": 1000,
      "system.resources.hits.value": 400
    });
    await game.dbzf.combatState.resetPhase(defender);
    const kiBefore = defender.system.resources.ki.value;
    const result = await game.dbzf.reactions.rollKiBarrier(defender, {
      dice: 10,
      incomingDamageDice: attack.damageDice,
      incomingDamage: attack.rawDamage,
      messageId: message.id,
      applyDamage: true
    });
    assert(!!result, "Ki Barrier should resolve against the selected attack");
    assert(defender.system.resources.ki.value === kiBefore - 100, "Ki Barrier should spend 10 Ki per die (10 dice = 100 Ki)", { actual: defender.system.resources.ki.value });
    assert(defender.system.combatState.reactionAvailable === false, "Ki Barrier should consume the reaction");
    const applications = message.getFlag("dbz-fuzion-calibrated", "applications") ?? [];
    const entry = applications.find(app => app.targetUuid === defender.uuid);
    assert(!!entry, "Ki Barrier should record its damage application on the attack message");
    assert(entry.result.kiDeflection.blocked >= 10 && entry.result.kiDeflection.blocked <= 60, "Barrier should roll 10d6 (result 10-60)", { blocked: entry.result?.kiDeflection?.blocked });
  });

  await test("Ki Barrier sizes itself against halved Area damage", async () => {
    const defender = await createActor("QA Barrier Area");
    await defender.update({
      "system.characteristics.mental.base": 30,
      "system.skills.power.rank": 30,
      "system.skills.mind.rank": 30,
      "system.resources.battlePower.value": 5000,
      "system.resources.ki.value": 1000,
      "system.resources.hits.value": 400
    });
    await game.dbzf.combatState.resetPhase(defender);
    const kiBefore = defender.system.resources.ki.value;
    // A secondary Area target only takes half the raw damage, so 10 incoming dice cost 5 to negate.
    const result = await game.dbzf.reactions.rollKiBarrier(defender, {
      dice: 10,
      incomingDamageDice: 10,
      incomingDamage: 200,
      areaSecondary: true,
      applyDamage: true
    });
    assert(!!result, "Ki Barrier should resolve for an Area secondary target");
    assert(defender.system.resources.ki.value === kiBefore - 50, "Half damage should halve the dice to negate (5 dice = 50 Ki)", { actual: defender.system.resources.ki.value, kiBefore });

    await game.dbzf.combatState.resetPhase(defender);
    const fullKiBefore = defender.system.resources.ki.value;
    await game.dbzf.reactions.rollKiBarrier(defender, { dice: 10, incomingDamageDice: 10, incomingDamage: 200, applyDamage: false });
    assert(defender.system.resources.ki.value === fullKiBefore - 100, "Full damage should still cost 10 Ki per die", { actual: defender.system.resources.ki.value });
  });

  await test("Area secondary damage is halved before the barrier reduces it", async () => {
    const defender = await createActor("QA Barrier Area Damage");
    await defender.update({ "system.resources.hits.value": 400 });
    const defense = defender.system.resources.defense.value;
    const result = await game.dbzf.applyDamageToTarget(defender, 200, {
      areaSecondary: true,
      kiDeflection: { rating: 1, blocked: 20, formula: "1d6", result: "20" },
      sourceName: "QA Area"
    });
    assert(result.preDeflectionRawDamage === 100, "Area secondary raw damage should be halved first", { actual: result.preDeflectionRawDamage });
    assert(result.rawDamage === 80, "The barrier should then subtract from the halved damage", { actual: result.rawDamage });
    assert(result.effectiveDamage === Math.max(0, 80 - defense), "Defense applies last", { actual: result.effectiveDamage, defense });
  });

  await test("Deflect auto-resolves: success negates, failure applies incoming damage to self", async () => {
    const actor = await createActor("QA Deflect Auto");
    await actor.update({ "system.resources.hits.value": 300 });
    // DC 0 is always met -> deflected, no damage.
    await game.dbzf.reactions.rollDeflect(actor, { dc: 0, incomingDamage: 100, autoApply: true });
    assert(actor.system.resources.hits.value === 300, "Successful deflect should take no damage", { hits: actor.system.resources.hits.value });

    await game.dbzf.combatState.resetPhase(actor);
    // DC 999 can never be met -> failed, incoming damage applied to self (minus defense).
    const defense = actor.system.resources.defense.value;
    await game.dbzf.reactions.rollDeflect(actor, { dc: 999, incomingDamage: 100, autoApply: true });
    const expected = 300 - Math.max(0, 100 - defense);
    assert(actor.system.resources.hits.value === expected, "Failed deflect should apply incoming damage to self", { hits: actor.system.resources.hits.value, expected, defense });
  });

  await test("Counterblast auto-applies the combined blast (backlash to self on failure)", async () => {
    const actor = await createActor("QA Counter Auto");
    await actor.update({
      "system.resources.battlePower.value": 1000,
      "system.resources.ki.value": 10000,
      "system.resources.hits.value": 300,
      "system.resources.tempHits.value": 0
    });
    // DC 50 cannot be met by 3d6 + half(mind+power) -> guaranteed failure -> backlash to self.
    const result = await game.dbzf.reactions.rollCounterblast(actor, { dc: 50, incomingDamage: 500 });
    assert(result && result.success === false, "Counterblast should fail at DC 50");
    assert(actor.system.resources.hits.value < 300, "Failed counterblast should backlash damage onto the caster", { hits: actor.system.resources.hits.value });
  });

  await test("Block auto-resolves: success negates, failure applies physical damage to self", async () => {
    const actor = await createActor("QA Block Auto");
    await actor.update({ "system.resources.hits.value": 300 });
    const defense = actor.system.resources.defense.value;
    await game.dbzf.reactions.rollBlock(actor, { dc: 0, incomingDamage: 120, autoApply: true });
    assert(actor.system.resources.hits.value === 300, "Successful block should take no damage", { hits: actor.system.resources.hits.value });
    await game.dbzf.combatState.resetPhase(actor);
    await game.dbzf.reactions.rollBlock(actor, { dc: 999, incomingDamage: 120, weapon: true, autoApply: true });
    const expected = 300 - Math.max(0, 120 - defense);
    assert(actor.system.resources.hits.value === expected, "Failed block should apply incoming damage to self", { hits: actor.system.resources.hits.value, expected });
  });

  await test("Parry auto-resolves and applies the chosen skill mode", async () => {
    const actor = await createActor("QA Parry Auto");
    await actor.update({ "system.skills.weapon.rank": 10, "system.resources.hits.value": 300 });
    // Weapon mode uses full Weapon Total; DC 0 always succeeds -> negated.
    const r = await game.dbzf.reactions.rollParry(actor, { dc: 0, incomingDamage: 100, mode: "weapon", autoApply: true });
    assert(r.success === true, "Parry at DC 0 should succeed");
    assert(actor.system.resources.hits.value === 300, "Successful parry should take no damage");
  });

  await test("Nullify forms a Fighting barrier that reduces incoming damage", async () => {
    const actor = await createActor("QA Nullify Auto");
    await actor.update({
      "system.characteristics.physical.base": 10,
      "system.skills.fighting.rank": 40,
      "system.resources.hits.value": 1000
    });
    const defense = actor.system.resources.defense.value;
    // DC 0 guarantees success -> barrier of (physical effective + fighting ranks) dice forms.
    const result = await game.dbzf.reactions.rollNullify(actor, { dc: 0, incomingDamage: 400, autoApply: true });
    assert(result.success === true, "Nullify at DC 0 should succeed");
    assert(result.barrier >= 50, "Barrier should be at least the dice count (10 + 40)", { barrier: result.barrier });
    const expectedEffective = Math.max(0, (400 - result.barrier) - defense);
    assert(result.damageApplication.effectiveDamage === expectedEffective, "Nullify barrier should reduce raw damage before defense", { got: result.damageApplication.effectiveDamage, expectedEffective, barrier: result.barrier, defense });
  });

  await test("Counterblast fails gracefully without enough Ki", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.ki.charged": 0 });
    const result = await game.dbzf.reactions.rollCounterblast(actor, { dc: 20 });
    assert(result === null, "Counterblast should fail without enough Ki");
    assert(actor.system.combatState.reactionAvailable === true, "Failed Counterblast should not spend reaction");
  });

  await test("Fake Out does not spend reaction without enough Ki", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.ki.value": 0, "system.resources.ki.charged": 0 });
    const result = await game.dbzf.reactions.rollFakeOut(actor, { cost: 50 });
    assert(result === null, "Fake Out should fail without enough Ki");
    assert(actor.system.combatState.reactionAvailable === true, "Failed Fake Out should not spend reaction");
  });

  await test("Counterblast can include a selected technique", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.battlePower.value": 1000, "system.resources.ki.value": 1000, "system.resources.ki.charged": 1000 });
    const [technique] = await actor.createEmbeddedDocuments("Item", [{
      name: "QA Counter Beam",
      type: "technique",
      system: { attackType: "power", tags: "counter,beam", qualities: "Deadly 1", kiCostResolved: 25 }
    }]);
    const result = await game.dbzf.reactions.rollCounterblast(actor, { dc: 20, techniqueId: technique.id, extraKi: 5 });
    assert(!!result, "Counterblast with technique failed");
    assert(actor.system.combatState.reactionAvailable === false, "Counterblast did not consume reaction");
    assert(actor.system.resources.ki.charged === 760, "Counterblast cost mismatch", { charged: actor.system.resources.ki.charged });
    const message = game.messages.contents.at(-1);
    assert(message.content.includes("QA Counter Beam"), "Counterblast chat missing technique name");
    assert(message.content.includes("counter,beam"), "Counterblast chat missing technique tags");
  });

  await test("Counterblast combines incoming and counter damage on failure", async () => {
    const actor = await createActor("QA Counterblast Backlash");
    await actor.update({
      "system.resources.battlePower.value": 1000,
      "system.resources.ki.value": 1000,
      "system.resources.ki.charged": 1000,
      "system.resources.hits.value": 300,
      "system.resources.tempHits.value": 0,
      "system.skills.power.rank": 5
    });
    const [technique] = await actor.createEmbeddedDocuments("Item", [{
      name: "QA Rebound Beam",
      type: "technique",
      system: { attackType: "power", tags: "counter", qualities: "Deadly 1", extraDice: 2, kiCostResolved: 0 }
    }]);
    const outcome = await game.dbzf.reactions.resolveCounterblastOutcome(actor, {
      dc: 99,
      rollTotal: 1,
      incomingDamage: 80,
      incomingQualities: "Burn 1",
      technique
    });
    assert(outcome.success === false, "Counterblast should fail");
    assert(outcome.combinedDamage >= 80, "Combined damage should include incoming and counter damage", outcome);
    assert(outcome.combinedQualities.includes("Burn 1"), "Combined qualities missing incoming effects", outcome);
    assert(outcome.combinedQualities.includes("Deadly 1"), "Combined qualities missing technique effects", outcome);
    assert(outcome.resultTargetUuid === actor.uuid, "Failed Counterblast should hit the counterblaster", outcome);
    assert(outcome.damageApplication === null, "Counterblast should not auto-apply damage", outcome);
    assert(actor.system.resources.hits.value === 300, "Counterblast outcome should leave manual damage application to the GM", outcome);
  });

  await test("Raise Characteristic boosts a characteristic for one phase then expires", async () => {
    const actor = await createActor("QA Raise Char");
    await actor.update({
      "system.characteristics.mental.base": 10,
      "system.resources.battlePower.value": 1000,
      "system.resources.ki.value": 1000
    });
    await game.dbzf.combatState.resetPhase(actor);
    const kiBefore = actor.system.resources.ki.value;
    await game.dbzf.reactions.rollRaiseCharacteristic(actor, { characteristic: "mental", points: 5 });
    assert(actor.system.characteristics.mental.effective === 15, "Mental should rise by 5", { actual: actor.system.characteristics.mental.effective });
    assert(actor.system.resources.ki.value === kiBefore - 50, "Should spend 10 Ki per point raised", { actual: actor.system.resources.ki.value });
    assert(actor.system.combatState.temporaryCharacteristics.length === 1, "Should track one temporary boost");
    assert(actor.system.combatState.reactionAvailable === false, "Should consume the reaction");
    await game.dbzf.combatState.advancePhase(actor);
    assert(actor.system.characteristics.mental.effective === 10, "Boost should expire after one phase", { actual: actor.system.characteristics.mental.effective });
    assert(actor.system.combatState.temporaryCharacteristics.length === 0, "Temporary boost should be cleared on Advance Phase");
  });

  await test("Raise Characteristic rejects Combat and over-cap point values", async () => {
    const actor = await createActor("QA Raise Char Limits");
    await actor.update({
      "system.characteristics.physical.base": 10,
      "system.resources.battlePower.value": 1000,
      "system.resources.ki.value": 1000
    });
    await game.dbzf.combatState.resetPhase(actor);
    const combat = await game.dbzf.reactions.rollRaiseCharacteristic(actor, { characteristic: "combat", points: 1 });
    assert(combat === null, "Combat cannot be raised as a Reaction");
    const over = await game.dbzf.reactions.rollRaiseCharacteristic(actor, { characteristic: "physical", points: 999 });
    assert(over === null, "Cannot raise a characteristic beyond its own value");
  });
}
