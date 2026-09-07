// Players can only write to documents they own, so damage, condition and Team Attack writes
// aimed at anyone else are handed to the GM's client. These tests cover the pieces that can be
// checked from a single client; the socket round trip itself needs a real second session.
async function settle(condition, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (condition()) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

export async function runPermissionTests({ test, assert, createActor }) {
  await test("GM relay registers its actions as user queries", async () => {
    for (const action of ["applyDamage", "recordChatApplication", "teamAttackAssist"]) {
      assert(typeof CONFIG.queries[`dbz-fuzion-calibrated.${action}`] === "function",
        `Relay action "${action}" is not registered as a query`);
    }
  });

  await test("A GM never relays, and relayed options are limited to damage flags", async () => {
    const actor = await createActor("QA Relay Options");
    assert(game.dbzf.needsGmRelay(actor) === false, "A GM should write directly rather than relaying");

    const relayed = game.dbzf.relayableDamageOptions({
      sourceName: "Probe",
      areaSecondary: true,
      effectsOnly: false,
      deadly: "3",
      qualities: "Deadly 3",
      kiDeflection: { rating: "2", blocked: "7", formula: "2d6", result: "7" },
      targetActor: actor,
      update: { "system.resources.hits.value": 0 }
    });
    assert(relayed.areaSecondary === true, "A true damage flag should survive");
    assert(!("effectsOnly" in relayed), "A false damage flag should be dropped");
    assert(relayed.deadly === 3 && relayed.kiDeflection.blocked === 7, "Numbers should be coerced");
    assert(!("targetActor" in relayed) && !("update" in relayed), "Unlisted keys must not cross the relay");
  });

  await test("A player's own conditions still reach the token HUD", async () => {
    const actor = await createActor("QA Condition Sync");
    // The mirror runs from the updateActor hook, so wait for it rather than syncing again here.
    const hasSealed = () => actor.effects.some(effect => effect.statuses.has("dbzfSealed"));
    await game.dbzf.statusEffects.addCondition(actor, { key: "sealed", sourceName: "QA", rating: 1, saveSkill: "mind", saveDC: 10 });
    await settle(hasSealed);
    assert(hasSealed(), "Sealed should mirror onto the actor's effects");

    await game.dbzf.statusEffects.removeCondition(actor, actor.system.combatState.activeConditions[0].id);
    await settle(() => !hasSealed());
    assert(!hasSealed(), "Clearing the condition should clear the status");
  });
}
