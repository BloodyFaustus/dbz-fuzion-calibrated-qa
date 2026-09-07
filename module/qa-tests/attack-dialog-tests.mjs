export async function runAttackDialogTests({ test, assert, createActor }) {
  await test("attack roll creates chat and spends Ki", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.ki.charged": 200 });
    const before = game.messages.size;
    await game.dbzf.rollAttack(actor, "fighting", { attackName: "QA Attack", kiSpent: 10, bonusDice: 0, qualities: "QA" });
    assert(game.messages.size > before, "No attack chat message created");
    assert(actor.system.resources.ki.charged === 190, "Charged Ki was not spent");
    assert(actor.system.resources.ki.spent === 10, "Spent Ki tracker did not increase");
  });

  await test("attack spending acceptance values", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.ki.charged": 200 });
    const result = await game.dbzf.rollAttack(actor, "fighting", { attackName: "QA Spend", kiSpent: 30, bonusDice: 2 });
    assert(result.damageRoll.formula.includes("15d6"), "Damage dice formula mismatch", { formula: result.damageRoll.formula });
    assert(actor.system.resources.ki.charged === 170, "Charged Ki after attack mismatch");
    assert(actor.system.resources.ki.spent === 30, "Spent Ki mismatch");
  });

  await test("attack consumes action and refuses when unavailable", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.ki.charged": 200 });
    const first = await game.dbzf.rollAttack(actor, "fighting", { kiSpent: 0 });
    assert(!!first, "First attack failed");
    assert(actor.system.combatState.actionAvailable === false, "Attack did not consume action");
    const second = await game.dbzf.rollAttack(actor, "fighting", { kiSpent: 0 });
    assert(second === null, "Second attack should fail without action");
  });

  await test("weapon attack uses weapon damage dice input", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.ki.charged": 200, "system.skills.weapon.rank": 2 });
    const [weapon] = await actor.createEmbeddedDocuments("Item", [{
      name: "QA Staff",
      type: "weapon",
      system: { damageDice: 7 }
    }]);
    const result = await game.dbzf.rollAttack(actor, "weapon", { attackName: "QA Weapon", weaponId: weapon.id, kiSpent: 0, bonusDice: 0 });
    assert(!!result, "Weapon attack did not roll");
    assert(result.damageRoll.formula.includes("19d6"), "Weapon damage should include Physical, Weapon rank, and weapon dice", { formula: result.damageRoll.formula });
  });

  await test("active item attack dice are included", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.ki.charged": 200 });
    await actor.createEmbeddedDocuments("Item", [{
      name: "QA Damage Aura",
      type: "technique",
      system: {
        active: true,
        effects: [{ enabled: true, label: "All Damage", target: "attacks.all.damageDice", mode: "add", value: 50, kiCostRaw: "", rulesText: "" }]
      }
    }]);
    const result = await game.dbzf.rollAttack(actor, "fighting", { attackName: "QA Boosted", kiSpent: 0, bonusDice: 0 });
    assert(result.damageRoll.formula.includes("60d6"), "Active attack damage dice not included", { formula: result.damageRoll.formula });
  });

  await test("body attack rolls", async () => {
    const actor = await createActor();
    const result = await game.dbzf.rollAttack(actor, "body", { attackName: "QA Body", kiSpent: 0, bonusDice: 0 });
    assert(!!result, "Body attack did not roll");
  });

  await test("custom skill attack uses selected custom skill", async () => {
    const actor = await createActor();
    await actor.update({
      "system.customSkills.0.name": "QA Signature Skill",
      "system.customSkills.0.rank": 7,
      "system.customSkills.0.linkedCharacteristic": "combat"
    });
    await actor.update({ "system.resources.ki.charged": 200 });
    const result = await game.dbzf.rollAttack(actor, "custom", { customSkillIndex: 0, attackName: "QA Custom", kiSpent: 0, bonusDice: 0 });
    assert(!!result, "Custom skill attack did not roll");
    assert(result.attackRoll.formula.includes("17"), "Custom skill attack did not use selected custom skill total", { formula: result.attackRoll.formula });
  });

  await test("starter technique effect affects matching attack", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.ki.charged": 200 });
    const technique = foundry.utils.deepClone(game.dbzf.starterContent.sampleItems.find(item => item.name === "Ki Blast"));
    technique.system.active = true;
    await actor.createEmbeddedDocuments("Item", [technique]);
    const result = await game.dbzf.rollAttack(actor, "power", { attackName: "QA Ki Blast", kiSpent: 0, bonusDice: 0 });
    assert(result.damageRoll.formula.includes("11d6"), "Starter Ki Blast effect did not affect power damage", { formula: result.damageRoll.formula });
  });

  await test("technique name and tags appear in attack chat", async () => {
    const actor = await createActor();
    await actor.update({ "system.resources.ki.charged": 200 });
    const [technique] = await actor.createEmbeddedDocuments("Item", [{
      name: "QA Meteor Burst",
      type: "technique",
      system: {
        attackType: "power",
        tags: "rush,finisher",
        qualities: "Flashy",
        extraDice: 1
      }
    }]);
    const before = game.messages.size;
    await game.dbzf.rollAttack(actor, "power", { techniqueId: technique.id, attackName: technique.name, tags: technique.system.tags, kiSpent: 0, bonusDice: 0 });
    const message = game.messages.contents.at(-1);
    assert(game.messages.size > before, "Technique attack did not create chat");
    assert(message.content.includes("QA Meteor Burst"), "Technique name missing from chat");
    assert(message.content.includes("rush,finisher"), "Technique tags missing from chat");
    const attack = message.getFlag("dbz-fuzion-calibrated", "attack");
    assert(attack.techniqueBonusDice === 1, "Technique bonus dice missing from attack flags", attack);
    assert(attack.manualBonusDice === 0, "Technique dice should not be reported as manual bonus dice", attack);
  });

  await test("typed technique mismatch is blocked", async () => {
    const actor = await createActor("DBZF QA Typed Technique Block");
    await actor.update({ "system.resources.ki.value": 200, "system.resources.ki.charged": 200 });
    const [technique] = await actor.createEmbeddedDocuments("Item", [{
      name: "QA Power Only",
      type: "technique",
      system: { attackType: "power", extraDice: 5 }
    }]);
    const before = game.messages.size;
    const result = await game.dbzf.rollAttack(actor, "fighting", { techniqueId: technique.id, consumeAction: false });
    assert(result === null, "Mismatched technique should be blocked");
    assert(game.messages.size === before, "Blocked technique should not create attack chat");
  });

  await test("technique and weapon images propagate to attack chat flags", async () => {
    const actor = await createActor("DBZF QA Image Attacker");
    await actor.update({ "system.resources.ki.value": 200, "system.resources.ki.charged": 200 });
    const [technique] = await actor.createEmbeddedDocuments("Item", [{
      name: "QA Image Beam",
      type: "technique",
      img: "icons/svg/fire.svg",
      system: { attackType: "power" }
    }]);
    await game.dbzf.rollAttack(actor, "power", { techniqueId: technique.id, consumeAction: false });
    let message = game.messages.contents.at(-1);
    assert(message.getFlag("dbz-fuzion-calibrated", "attack").chatImg === "icons/svg/fire.svg", "Technique image missing from attack flag");

    const [weapon] = await actor.createEmbeddedDocuments("Item", [{
      name: "QA Image Sword",
      type: "weapon",
      img: "icons/svg/sword.svg",
      system: { damageDice: 3 }
    }]);
    await game.dbzf.rollAttack(actor, "weapon", { weaponId: weapon.id, weaponDamageDice: weapon.system.damageDice, consumeAction: false });
    message = game.messages.contents.at(-1);
    assert(message.getFlag("dbz-fuzion-calibrated", "attack").chatImg === "icons/svg/sword.svg", "Weapon image missing from attack flag");
  });

  await test("Deadly and Homing quality parsing", async () => {
    const ratings = game.dbzf.parseQualityRatings("Deadly 5; Burn 3, Slow 2; +Homing 1; Multi 3 (1d4-1)");
    assert(ratings.deadly === 5, "Deadly rating parse failed");
    assert(ratings.burn === 3, "Burn rating parse failed");
    assert(ratings.slow === 2, "Slow rating parse failed");
    assert(ratings.homing === 1, "Homing rating parse failed");
    assert(ratings.multi === 3, "Multi rating parse failed");
    assert(game.dbzf.homingAttackBonusDice("Homing 2", { attackType: "power", defenseType: "evasion" }) === 6, "Homing evasion bonus failed");
    assert(game.dbzf.homingAttackBonusDice("Homing 2", { attackType: "power", defenseType: "deflect" }) === 0, "Homing should not apply vs Deflect");
  });

  await test("damage application: Defense up front, then Temp HITs then current HITs, Deadly bypass", async () => {
    const target = await createActor("DBZF QA Target");
    await target.update({ "system.resources.tempHits.value": 100, "system.resources.hits.value": 300 });
    let result = await game.dbzf.applyDamageToTarget(target, 190);
    assert(result.adjustedDefense === 50, "Adjusted defense mismatch");
    assert(result.effectiveDamage === 140, "Effective damage mismatch (190 - 50 defense)");
    assert(target.system.resources.tempHits.value === 0, "Temp HITs should be spent first");
    assert(target.system.resources.hits.value === 260, "Current HITs take the remainder (140 - 100 Temp = 40)");

    // Defense reduces the hit for every layer, so a hit below Defense does nothing.
    await target.update({ "system.resources.tempHits.value": 100, "system.resources.hits.value": 300 });
    result = await game.dbzf.applyDamageToTarget(target, 40);
    assert(result.effectiveDamage === 0, "A hit below Defense should be fully blocked", { actual: result.effectiveDamage });
    assert(target.system.resources.tempHits.value === 100, "Temp HITs untouched when Defense blocks the hit");
    assert(target.system.resources.hits.value === 300, "Current HITs untouched when Defense blocks the hit");

    // Deadly negates Defense, so the full hit gets through.
    await target.update({ "system.resources.tempHits.value": 100, "system.resources.hits.value": 300 });
    result = await game.dbzf.applyDamageToTarget(target, 190, { qualities: "Deadly 5" });
    assert(result.adjustedDefense === 0, "Deadly adjusted defense mismatch");
    assert(result.effectiveDamage === 190, "Deadly effective damage mismatch");
    assert(target.system.resources.tempHits.value === 0, "Temp HITs after Deadly mismatch");
    assert(target.system.resources.hits.value === 210, "HITs after Deadly (100 Temp + 90 HITs)");
  });

  await test("damage flows Temp HITs -> Armor -> current HITs and destroys armor", async () => {
    const target = await createActor("DBZF QA Armor Target");
    const [armor] = await target.createEmbeddedDocuments("Item", [{
      name: "QA Ablative Armor",
      type: "armor",
      system: { active: true, destroyed: false, defenseBonus: 0, bonusHits: 30, currentHits: 30, effects: [] }
    }]);
    target.prepareData();
    // Armor HP is a separate absorbing layer, not part of max HITs.
    assert(target.system.resources.hits.max === 300, "Armor HP should not inflate max HITs", { max: target.system.resources.hits.max });
    await target.update({ "system.resources.tempHits.value": 20, "system.resources.hits.value": 300 });

    // 90 damage, Deadly 5 (base defense 50 -> 0 at the HIT step). Temp 20 soaks first, armor 30 next,
    // 40 reaches current HITs.
    const result = await game.dbzf.applyDamageToTarget(target, 90, { qualities: "Deadly 5" });
    const updatedArmor = target.items.get(armor.id);
    assert(result.tempHitsBefore === 20 && result.tempHitsAfter === 0, "Temp HITs should absorb first", { before: result.tempHitsBefore, after: result.tempHitsAfter });
    assert(result.armor.absorbed === 30, "Armor should absorb its HIT pool after Temp HITs", result.armor);
    assert(updatedArmor.system.currentHits === 0, "Armor current HITs did not deplete");
    assert(updatedArmor.system.destroyed === true, "Armor was not marked destroyed");
    assert(updatedArmor.system.active === false, "Destroyed armor was not unequipped");
    assert(target.system.resources.hits.value === 260, "Current HITs take the remainder (90 - 20 temp - 30 armor = 40)", { hits: target.system.resources.hits.value });
    target.prepareData();
    assert(target.system.resources.hits.max === 300, "Max HITs unchanged by armor destruction", { max: target.system.resources.hits.max });
  });

  await test("armor Defense bonus applies while intact and is negated after it breaks", async () => {
    const target = await createActor("DBZF QA Armor Defense");
    await target.createEmbeddedDocuments("Item", [{
      name: "QA Def Armor",
      type: "armor",
      system: { active: true, destroyed: false, defenseBonus: 20, bonusHits: 10, currentHits: 10, effects: [] }
    }]);
    target.prepareData();
    assert(target.system.resources.defense.value === 70, "Active armor adds its Defense bonus (50 + 20)", { def: target.system.resources.defense.value });
    await target.update({ "system.resources.tempHits.value": 0, "system.resources.hits.value": 500 });

    // First hit: armor intact, Defense 70. 100 - 70 = 30; armor soaks its 10 and breaks; 20 to HITs.
    const first = await game.dbzf.applyDamageToTarget(target, 100, {});
    assert(first.armor.absorbed === 10, "Armor absorbs its 10 HP", first.armor);
    assert(target.system.resources.hits.value === 480, "First hit uses full Defense 70 (100 - 70 = 30, armor 10, 20 to HITs)", { hits: target.system.resources.hits.value });
    target.prepareData();
    assert(target.system.resources.defense.value === 50, "Broken armor's Defense bonus is negated afterward", { def: target.system.resources.defense.value });

    // Second hit: armor gone, Defense 50. 100 - 50 = 50 to HITs.
    await game.dbzf.applyDamageToTarget(target, 100, {});
    assert(target.system.resources.hits.value === 430, "Second hit uses the reduced Defense 50 (100 - 50 = 50)", { hits: target.system.resources.hits.value });
  });

  await test("Burn and Slow apply and tick from damage", async () => {
    const target = await createActor("DBZF QA Status Target");
    await target.update({ "system.resources.tempHits.value": 50, "system.resources.hits.value": 300 });
    const result = await game.dbzf.applyDamageToTarget(target, 120, { qualities: "Burn 2, Slow 3", sourceName: "QA Status Hit" });
    assert(result.effectiveDamage === 70, "Status damage effective mismatch");
    assert(target.system.combatState.activeConditions.some(condition => condition.key === "burn"), "Burn condition missing");
    assert(target.system.combatState.activeConditions.some(condition => condition.key === "slow"), "Slow condition missing");
    await game.dbzf.statusEffects.advanceOngoingEffects(target);
    assert(target.system.resources.hits.value === 220, "Burn tick should apply half raw damage after temp is gone", { hits: target.system.resources.hits.value });
    assert(target.system.combatState.activeConditions.some(condition => condition.key === "slow" && condition.rating === 2), "Slow did not degrade");
  });

  await test("condition save and remove helpers work", async () => {
    const actor = await createActor("DBZF QA Condition Actor");
    const condition = await game.dbzf.statusEffects.addCondition(actor, { key: "sealed", rating: 1, saveSkill: "mind", saveDC: 1 });
    const save = await game.dbzf.statusEffects.rollConditionSave(actor, condition.id);
    assert(save.success === true, "Low DC condition save should pass");
    assert(!actor.system.combatState.activeConditions.some(entry => entry.id === condition.id), "Successful save did not remove condition");
    const second = await game.dbzf.statusEffects.addCondition(actor, { key: "immobilized", rating: 1, saveSkill: "body", saveDC: 99 });
    await game.dbzf.statusEffects.removeCondition(actor, second.id);
    assert(!actor.system.combatState.activeConditions.some(entry => entry.id === second.id), "Manual condition removal failed");
  });

  await test("Multi quality resolves multiple damage instances", async () => {
    const target = await createActor("DBZF QA Multi Target");
    await target.update({ "system.resources.tempHits.value": 0, "system.resources.hits.value": 1000 });
    const result = await game.dbzf.applyDamageToTarget(target, 100, { qualities: "Multi 3" });
    assert(result.multi?.totalHits >= 1, "Multi result missing hit data");
    assert(target.system.resources.hits.value <= 950, "Multi did not apply at least the primary hit");
  });

  await test("Area secondary damage halves raw damage before Defense", async () => {
    const primary = await createActor("DBZF QA Area Primary");
    const secondary = await createActor("DBZF QA Area Secondary");
    await primary.update({ "system.resources.tempHits.value": 0, "system.resources.hits.value": 300 });
    await secondary.update({ "system.resources.tempHits.value": 0, "system.resources.hits.value": 300 });
    const primaryResult = await game.dbzf.applyDamageToTarget(primary, 150, { qualities: "Area 2" });
    const secondaryResult = await game.dbzf.applyDamageToTarget(secondary, 150, { qualities: "Area 2", areaSecondary: true });
    assert(primaryResult.effectiveDamage === 100, "Primary Area damage mismatch", primaryResult);
    assert(secondaryResult.rawDamage === 75, "Secondary Area raw damage should halve before Defense", secondaryResult);
    assert(secondaryResult.effectiveDamage === 25, "Secondary Area effective damage mismatch", secondaryResult);
  });

  await test("embedded weapon and technique qualities merge into attacks", async () => {
    const actor = await createActor("DBZF QA Embedded Quality Attacker");
    await actor.update({ "system.resources.ki.value": 200, "system.resources.ki.charged": 200 });
    const [technique] = await actor.createEmbeddedDocuments("Item", [{
      name: "QA Burning Beam",
      type: "technique",
      system: {
        attackType: "power",
        qualities: "Deadly 1",
        embeddedQualities: [{ name: "Burn", key: "burn", rating: 2, rulesText: "" }]
      }
    }]);
    await game.dbzf.rollAttack(actor, "power", { techniqueId: technique.id, consumeAction: false });
    const message = game.messages.contents.at(-1);
    const attack = message.getFlag("dbz-fuzion-calibrated", "attack");
    assert(attack.qualityRatings.deadly === 1, "Technique text quality did not merge");
    assert(attack.qualityRatings.burn === 2, "Technique embedded quality did not merge");
  });

  await test("embedded quality Ki costs are added when enabled", async () => {
    const actor = await createActor("DBZF QA Quality Cost Attacker");
    await actor.update({ "system.resources.ki.value": 200, "system.resources.ki.charged": 200 });
    const [technique] = await actor.createEmbeddedDocuments("Item", [{
      name: "QA Burning Cost Beam",
      type: "technique",
      system: {
        attackType: "power",
        embeddedQualities: [{ name: "Burn", key: "burn", rating: 5, costKi: true, cost: 0, rulesText: "" }]
      }
    }]);
    await game.dbzf.rollAttack(actor, "power", { techniqueId: technique.id, consumeAction: false });
    const message = game.messages.contents.at(-1);
    const attack = message.getFlag("dbz-fuzion-calibrated", "attack");
    assert(attack.qualityKiCost === 50, "Burn 5 should add 50 Ki when quality cost is enabled", attack);
    assert(attack.damageFormula === "10d6", "Quality Ki cost should not add damage dice", attack);
    assert(actor.system.resources.ki.charged === 150, "Embedded quality Ki cost was not spent");
  });

  await test("technique activation cost does not add damage dice", async () => {
    const actor = await createActor("DBZF QA Activation Cost Attacker");
    await actor.update({ "system.resources.ki.value": 200, "system.resources.ki.charged": 200 });
    const [technique] = await actor.createEmbeddedDocuments("Item", [{
      name: "QA Cost Beam",
      type: "technique",
      system: { attackType: "power", kiCostResolved: 50 }
    }]);
    await game.dbzf.rollAttack(actor, "power", { techniqueId: technique.id, kiSpent: 0, consumeAction: false });
    const attack = game.messages.contents.at(-1).getFlag("dbz-fuzion-calibrated", "attack");
    assert(attack.activationKiCost === 50, "Activation Ki cost missing from flags", attack);
    assert(attack.damageKiSpent === 0, "Activation cost should not become damage Ki", attack);
    assert(attack.damageFormula === "10d6", "Activation Ki cost should not add damage dice", attack);
    assert(actor.system.resources.ki.charged === 150, "Activation Ki cost was not spent");
  });

  await test("each rating of a common modifier consumes a capacity slot", async () => {
    const burn = game.dbzf.parseQualityRatings("Burn 5");
    assert(game.dbzf.qualities.normalModifierCount(burn) === 5, "Burn 5 should consume five modifier slots",
      { actual: game.dbzf.qualities.normalModifierCount(burn) });
    const deadly = game.dbzf.parseQualityRatings("Deadly 14");
    assert(game.dbzf.qualities.normalModifierCount(deadly) === 14, "Deadly 14 should consume fourteen slots",
      { actual: game.dbzf.qualities.normalModifierCount(deadly) });
    const mixed = game.dbzf.parseQualityRatings("Deadly 3; Rapid 2; Slow 1");
    assert(game.dbzf.qualities.normalModifierCount(mixed) === 6, "Ratings should sum across qualities",
      { actual: game.dbzf.qualities.normalModifierCount(mixed) });
    // Non-common qualities (Super/Full Power/True/Multi/Duration/Penetrate) never use capacity.
    const special = game.dbzf.parseQualityRatings("Attack, Super; Multi 3; Deadly 2");
    assert(game.dbzf.qualities.normalModifierCount(special) === 2, "Only common modifiers count",
      { actual: game.dbzf.qualities.normalModifierCount(special) });
  });

  await test("control qualities apply conditions with no damage in effects-only mode", async () => {
    const actor = await createActor("DBZF QA Sealer");
    const target = await createActor("DBZF QA Sealed");
    await actor.update({ "system.resources.ki.value": 400, "system.resources.ki.charged": 400 });
    await target.update({ "system.resources.hits.value": 300, "system.resources.tempHits.value": 40,
      "system.combatState.activeConditions": [] });
    await game.dbzf.rollAttack(actor, "power", { attackName: "QA Seal", qualities: "Sealing 2; Immobilization 3", consumeAction: false });
    const message = game.messages.contents.at(-1);
    // Sealing/Immobilization now zero damage automatically, so the card offers the OVERRIDE.
    assert(/dbzf-apply-force-damage/.test(message.content), "Control attack should offer a deal-damage override");

    const hitsBefore = target.system.resources.hits.value;
    const tempBefore = target.system.resources.tempHits.value;
    // No flag needed: a plain apply must already deal zero damage.
    const result = await game.dbzf.applyChatDamage(message, { targetActor: target });
    assert(result.effectsOnly === true, "Result should be flagged effects-only");
    assert(result.zeroDamageReason === "control", "Zeroing should be attributed to the control quality",
      { actual: result.zeroDamageReason });
    assert(result.effectiveDamage === 0, "Effects-only must report zero effective damage", { actual: result.effectiveDamage });
    assert(target.system.resources.hits.value === hitsBefore, "HITs must be untouched", { actual: target.system.resources.hits.value });
    assert(target.system.resources.tempHits.value === tempBefore, "Temp HITs must be untouched", { actual: target.system.resources.tempHits.value });
    const keys = target.system.combatState.activeConditions.map(c => c.key).sort();
    assert(keys.join(",") === "immobilized,sealed", "Both conditions should still land", { actual: keys.join(",") });
  });

  await test("forceDamage overrides automatic zeroing", async () => {
    const actor = await createActor("DBZF QA Forcer");
    const target = await createActor("DBZF QA Forced");
    await actor.update({ "system.resources.ki.value": 400, "system.resources.ki.charged": 400,
      "system.skills.power.rank": 60 });
    await target.update({ "system.resources.hits.value": 3000, "system.combatState.activeConditions": [] });
    await game.dbzf.rollAttack(actor, "power", { attackName: "QA Seal Force", qualities: "Sealing 2", consumeAction: false });
    const message = game.messages.contents.at(-1);
    const before = target.system.resources.hits.value;
    const result = await game.dbzf.applyChatDamage(message, { targetActor: target, forceDamage: true });
    assert(result.effectsOnly === false, "forceDamage must defeat the automatic zeroing");
    assert(target.system.resources.hits.value < before, "forceDamage should deal real damage",
      { before, after: target.system.resources.hits.value });
  });

  await test("Multi reports additional hits and keeps the original raw damage", async () => {
    const actor = await createActor("DBZF QA Multi");
    const target = await createActor("DBZF QA Multi Target");
    await actor.update({ "system.resources.ki.value": 400, "system.resources.ki.charged": 400,
      "system.skills.fighting.rank": 60 });
    await target.update({ "system.resources.hits.value": 5000, "system.resources.tempHits.value": 0 });
    await game.dbzf.rollAttack(actor, "fighting", { attackName: "QA Multi", qualities: "Multi 3", consumeAction: false });
    const message = game.messages.contents.at(-1);
    const rolledRaw = message.getFlag("dbz-fuzion-calibrated", "attack").rawDamage;
    const result = await game.dbzf.applyChatDamage(message, { targetActor: target });
    assert(result.originalRawDamage === rolledRaw,
      "Multi must report the attack's original raw damage, not the last strike's halved value",
      { rolledRaw, reported: result.originalRawDamage });
    assert(result.multi.additionalHits === result.multi.totalHits - 1,
      "additionalHits must exclude the opening strike",
      { additional: result.multi.additionalHits, total: result.multi.totalHits });
    assert(typeof result.multi.baseEffectiveDamage === "number" && typeof result.multi.totalEffectiveDamage === "number",
      "Multi should report effective damage before and after");
  });

  await test("a plain attack still deals damage after the effects-only change", async () => {
    const actor = await createActor("DBZF QA Striker");
    const target = await createActor("DBZF QA Struck");
    // The baseline fixture's Defense is 50; a rank-0 attack rolls ~35 and would be fully absorbed,
    // so give the attacker enough Fighting rank for damage to actually get through.
    await actor.update({ "system.resources.ki.value": 200, "system.resources.ki.charged": 200,
      "system.skills.fighting.rank": 40 });
    await target.update({ "system.resources.hits.value": 300, "system.resources.tempHits.value": 0 });
    await game.dbzf.rollAttack(actor, "fighting", { attackName: "QA Plain", consumeAction: false });
    const message = game.messages.contents.at(-1);
    const before = target.system.resources.hits.value;
    const result = await game.dbzf.applyChatDamage(message, { targetActor: target });
    assert(result.effectsOnly !== true, "Normal application must not be effects-only");
    assert(target.system.resources.hits.value < before, "Normal attack should still reduce HITs",
      { before, after: target.system.resources.hits.value });
  });

  await test("attack chat stores flags and applies damage once", async () => {
    const actor = await createActor("DBZF QA Attacker");
    const target = await createActor("DBZF QA Chat Target");
    await actor.update({ "system.resources.ki.value": 200, "system.resources.ki.charged": 200 });
    await target.update({ "system.resources.tempHits.value": 25, "system.resources.hits.value": 300 });
    await game.dbzf.rollAttack(actor, "fighting", { attackName: "QA Flag Attack", qualities: "Deadly 5", consumeAction: false });
    const message = game.messages.contents.at(-1);
    assert(!!message.getFlag("dbz-fuzion-calibrated", "attack"), "Attack chat flag missing");
    const applied = await game.dbzf.applyChatDamage(message, { targetActor: target });
    assert(!!applied, "Chat damage application failed");
    const blocked = await game.dbzf.applyChatDamage(message, { targetActor: target });
    assert(blocked === null, "Duplicate chat damage application should be blocked");
  });

  await test("attack chat can apply to multiple explicit targets", async () => {
    const actor = await createActor("DBZF QA Area Attacker");
    const first = await createActor("DBZF QA Area First");
    const second = await createActor("DBZF QA Area Second");
    await actor.update({ "system.resources.ki.value": 200, "system.resources.ki.charged": 200 });
    await first.update({ "system.resources.tempHits.value": 0, "system.resources.hits.value": 300 });
    await second.update({ "system.resources.tempHits.value": 0, "system.resources.hits.value": 300 });
    await game.dbzf.rollAttack(actor, "power", { attackName: "QA Area", qualities: "Area 1", consumeAction: false });
    const message = game.messages.contents.at(-1);
    const attack = foundry.utils.deepClone(message.getFlag("dbz-fuzion-calibrated", "attack"));
    attack.rawDamage = 150;
    await message.setFlag("dbz-fuzion-calibrated", "attack", attack);
    const results = await game.dbzf.applyChatDamageToTargets(message, { targetActors: [first, second] });
    assert(results.length === 2, "Multi-target chat application did not apply twice");
    assert(first.system.resources.hits.value < second.system.resources.hits.value, "Primary should take more damage than secondary");
  });

  await test("Mind and Evasion attacks (and Mind-typed techniques) calculate correctly", async () => {
    const actor = await createActor("QA Special Attacks");
    await actor.update({
      "system.characteristics.physical.base": 10,
      "system.characteristics.mental.base": 10,
      "system.skills.mind.rank": 20,
      "system.skills.evasion.rank": 15,
      "system.resources.battlePower.value": 1000,
      "system.resources.ki.value": 500
    });
    await game.dbzf.combatState.resetPhase(actor);
    const mind = await game.dbzf.rollAttack(actor, "mind", { consumeAction: false });
    assert(mind.damage.count === 30, "Mind damage dice = Mental effective (10) + Mind rank (20)", { actual: mind.damage.count });
    await game.dbzf.combatState.resetPhase(actor);
    const eva = await game.dbzf.rollAttack(actor, "evasion", { consumeAction: false });
    assert(eva.damage.count === 25, "Evasion damage dice = Physical effective (10) + Evasion rank (15)", { actual: eva.damage.count });
    // A Mind-typed technique is usable with a Mind attack and adds its extra dice.
    const [tech] = await actor.createEmbeddedDocuments("Item", [{ name: "QA Psy", type: "technique", system: { attackType: "mind", extraDice: 5, active: true } }]);
    await game.dbzf.combatState.resetPhase(actor);
    const withTech = await game.dbzf.rollAttack(actor, "mind", { consumeAction: false, techniqueId: tech.id });
    assert(withTech.damage.count === 35, "Mind technique should add its extra dice (30 + 5)", { actual: withTech.damage.count });
  });

  await test("Oversized damage pools split into dice-limit-safe chunks", async () => {
    const actor = await createActor("QA Big Pool");
    await actor.update({
      "system.characteristics.physical.base": 600,
      "system.skills.fighting.rank": 600,
      "system.resources.battlePower.value": 100000,
      "system.resources.ki.value": 5000
    });
    await game.dbzf.combatState.resetPhase(actor);
    const result = await game.dbzf.rollAttack(actor, "fighting", { consumeAction: false });
    assert(result.damage.count === 1200, "Damage dice should be 1200 (Physical 600 + Fighting 600)", { actual: result.damage.count });
    assert(result.damage.chunked === true, "A pool over 999 dice must be chunked");
    assert(result.damage.chunkRolls.length === 2, "1200d6 should split into 2 chunks (999 + 201)", { actual: result.damage.chunkRolls.length });
    assert(result.damage.total >= 1200 && result.damage.total <= 7200, "Chunked total should be a valid 1200d6 sum", { actual: result.damage.total });
    assert(result.damageRoll.total === result.damage.total, "Display roll total should match the summed pool", { display: result.damageRoll.total, pool: result.damage.total });
  });

  await test("Attack roll exposes individual d6 results including Homing bonus dice", async () => {
    const actor = await createActor("QA Attack Dice");
    await actor.update({
      "system.characteristics.mental.base": 10,
      "system.skills.power.rank": 30,
      "system.resources.battlePower.value": 1000,
      "system.resources.ki.value": 500
    });
    await game.dbzf.combatState.resetPhase(actor);
    const plain = await game.dbzf.rollAttack(actor, "power", { consumeAction: false });
    assert(plain.attackDiceResults.length === 3, "A normal attack rolls 3 individual d6", { actual: plain.attackDiceResults.length });
    await game.dbzf.combatState.resetPhase(actor);
    // Homing 2 on a Power attack vs Evasion adds 3 attack dice per rating (3 + 6 = 9 total).
    const homing = await game.dbzf.rollAttack(actor, "power", { consumeAction: false, qualities: "Homing 2", defenseType: "evasion" });
    assert(homing.attackDiceResults.length === 9, "Homing 2 should add 6 bonus attack dice (3 + 6)", { actual: homing.attackDiceResults.length });
    assert(homing.attackDiceResults.every(die => die >= 1 && die <= 6), "Each attack die should be a valid d6 result");
  });
}
