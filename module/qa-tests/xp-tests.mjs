export async function runXpTests({ test, assert, createActor }) {
  await test("combat XP matches PDF BP disparity example", async () => {
    const a = await createActor("QA 220 BP");
    const b = await createActor("QA 320 BP");
    await a.update({ "system.resources.battlePower.value": 220 });
    await b.update({ "system.resources.battlePower.value": 320 });
    const report = game.dbzf.calculateFightXp({ sideA: [a], sideB: [b] });
    const pa = report.participants.find(p => p.actorUuid === a.uuid);
    const pb = report.participants.find(p => p.actorUuid === b.uuid);
    assert(Math.abs(pa.modifiedXp - 14.54545) < 0.01, "A XP mismatch", pa);
    assert(Math.abs(pb.modifiedXp - 6.875) < 0.01, "B XP mismatch", pb);
  });

  await test("combat XP applies Earthling and Saiyan multipliers", async () => {
    const earthling = await createActor("QA Earthling");
    const saiyan = await createActor("QA Saiyan");
    await earthling.update({ "system.resources.battlePower.value": 220 });
    await saiyan.update({ "system.resources.battlePower.value": 320 });
    await earthling.createEmbeddedDocuments("Item", [{ name: "Earthling", type: "species", system: { active: true, xpMultiplier: 1.25 } }]);
    await saiyan.createEmbeddedDocuments("Item", [{ name: "Saiyan", type: "species", system: { active: true, xpFightMultiplier: 1.25, xpLossMultiplier: 1.5 } }]);
    const report = game.dbzf.calculateFightXp({ sideA: [earthling], sideB: [{ actor: saiyan, result: "loss" }] });
    const pe = report.participants.find(p => p.actorUuid === earthling.uuid);
    const ps = report.participants.find(p => p.actorUuid === saiyan.uuid);
    assert(Math.abs(pe.modifiedXp - 18.1818) < 0.01, "Earthling XP mismatch", pe);
    assert(Math.abs(ps.modifiedXp - 10.3125) < 0.01, "Saiyan loss XP mismatch", ps);
  });

  await test("combat XP report splits spendable and BP growth", async () => {
    const a = await createActor("QA Split A");
    const b = await createActor("QA Split B");
    await a.update({ "system.resources.battlePower.value": 220 });
    await b.update({ "system.resources.battlePower.value": 320 });
    const report = game.dbzf.calculateFightXp({ sideA: [a], sideB: [b] });
    const pa = report.participants.find(p => p.actorUuid === a.uuid);
    assert(Math.abs(pa.spendableXp - 7.2727) < 0.01, "Spendable XP mismatch", pa);
    assert(Math.abs(pa.bpGrowthPercent - 7.2727) < 0.01, "BP growth mismatch", pa);
  });

  await test("applyFightXp mutates only explicit actor", async () => {
    const actor = await createActor("QA XP Apply");
    await actor.update({ "system.resources.battlePower.value": 200 });
    await game.dbzf.applyFightXp(actor, { modifiedXp: 20, spendableXp: 10, bpGrowthPercent: 10 });
    assert(actor.system.experience.total === 20, "Total XP not applied");
    assert(actor.system.experience.unspent === 10, "Unspent XP not applied");
    assert(actor.system.resources.battlePower.value === 220, "BP growth not applied");
  });

  await test("XP tool API opens without throwing", async () => {
    assert(typeof game.dbzf.openXpEncounterTool === "function", "XP tool API missing");
  });

  await test("XP tool never substitutes an unrelated actor when nothing is selected", async () => {
    canvas?.tokens?.releaseAll?.();
    for (const token of Array.from(game.user.targets)) token.setTarget(false, { releaseOthers: false });
    const before = game.messages.size;
    const openIds = new Set(foundry.applications.instances.keys());
    game.dbzf.openXpEncounterTool();
    await new Promise(resolve => setTimeout(resolve, 700));
    const dialog = Array.from(foundry.applications.instances.values()).find(x => !openIds.has(x.id));
    assert(game.messages.size === before, "XP tool posted a report without an explicit selection");
    assert(!!dialog, "XP tool should prompt for participants when nothing is selected");
    dialog.element.remove();
    foundry.applications.instances.delete(dialog.id);
  });
}
