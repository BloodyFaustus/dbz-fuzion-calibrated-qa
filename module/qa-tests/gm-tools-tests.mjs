export async function runGmToolsTests({ test, assert }) {
  await test("GM tools module is available and GM guarded", async () => {
    assert(game.modules.get("dbz-fuzion-gm-tools")?.active, "GM tools module is not active");
    assert(!!game.dbzfGmTools, "GM tools API missing");
    assert(typeof game.dbzfGmTools.npcSeederDryRun === "function", "NPC dry-run API missing");
    assert(typeof game.dbzfGmTools.seedLegacyNpcCompendium === "function", "NPC seeder API missing");
    assert(typeof game.dbzfGmTools.auditLegacyTransformationConversions === "function", "Legacy transformation audit API missing");
    assert(typeof game.dbzfGmTools.openPanel === "function", "GM tools panel API missing");
    assert(typeof game.dbzfGmTools.openPowerCalibrationTool === "function", "Calibration tool API missing");
  });

  await test("legacy NPC dry run reports expected include/exclude counts", async () => {
    const result = await game.dbzfGmTools.npcSeederDryRun();
    assert(result.included === 98, "Legacy NPC included count mismatch", result);
    assert(result.excluded === 12, "Legacy NPC excluded count mismatch", result);
    assert(result.pack === "dbz-fuzion-gm-tools.legacy-npcs", "Legacy NPC pack id mismatch", result);
    assert(result.actorType === "character", "Legacy NPC importer should create character actors", result);
  });

  await test("legacy NPC seeder dry-run path is callable without importing duplicates", async () => {
    const result = await game.dbzfGmTools.seedLegacyNpcCompendium({ dryRun: true });
    assert(result.included === 98, "Seeder dry-run included count mismatch", result);
    assert(result.excluded === 12, "Seeder dry-run excluded count mismatch", result);
    assert(result.actorType === "character", "Seeder dry-run actor type mismatch", result);
  });

  await test("legacy buff techniques are converted to transformation items", async () => {
    const result = await game.dbzfGmTools.auditLegacyTransformationConversions();
    assert(result.convertedCount >= 3, "Expected converted legacy transformations", result);
    const has = (actor, item) => result.converted.some(entry => entry.actor === actor && entry.item === item && entry.effects > 0);
    assert(has("Zarbon", "Monster Form"), "Zarbon Monster Form was not converted with effects", result.examples);
    assert(has("Yujiro Hanma", "Demon Back (Monster Form)"), "Yujiro Demon Back was not converted with effects", result.examples);
    assert(has("Dra", "Magic Burst"), "Dra Magic Burst was not converted with effects", result.examples);
  });

  await test("legacy NPC pack exists", () => {
    const pack = game.packs.get("dbz-fuzion-gm-tools.legacy-npcs");
    assert(!!pack, "Legacy NPC pack missing");
    assert(pack.metadata.type === "Actor", "Legacy NPC pack is not an Actor pack");
  });

  await test("canon reference rows include required acceptance samples", async () => {
    const rows = await game.dbzfGmTools.loadCanonPowerRows();
    const has = (name, bp) => rows.some(row =>
      String(row.character ?? "").toLowerCase().includes(name.toLowerCase())
      && Number(row.bp_min) === bp
    );
    assert(has("Raditz", 1500), "Raditz 1500 canon row missing");
    assert(has("Nappa", 4000), "Nappa 4000 canon row missing");
    assert(has("Vegeta", 18000), "Vegeta 18000 canon row missing");
    assert(has("Frieza", 530000), "Frieza First Form 530000 canon row missing");
    assert(has("Goku", 150000000), "Goku Super Saiyan 150000000 canon row missing");
  });
}
