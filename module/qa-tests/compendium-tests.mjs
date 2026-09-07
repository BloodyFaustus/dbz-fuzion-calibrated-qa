export async function runCompendiumTests({ test, assert }) {
  await test("expected compendia exist", () => {
    for (const key of ["dbz-fuzion-calibrated.transformations", "dbz-fuzion-calibrated.qualities", "dbz-fuzion-calibrated.species", "dbz-fuzion-calibrated.sample-actors", "dbz-fuzion-calibrated.sample-items", "dbz-fuzion-calibrated.core-rulebook"]) {
      assert(game.packs.has(key), `Missing pack ${key}`);
    }
  });

  await test("starter content definitions exist and cover core categories", () => {
    const content = game.dbzf.starterContent;
    assert(content.species.length >= 11, "Starter species too sparse");
    assert(content.qualities.length >= 18, "Starter qualities too sparse");
    assert(content.transformations.length >= 5, "Starter transformations too sparse");
    assert(content.sampleItems.length >= 5, "Starter sample items too sparse");
    assert(content.sampleActors.length >= 1, "Starter sample actors missing");
  });

  await test("starter species and qualities include required rules keys", () => {
    const speciesKeys = new Set(game.dbzf.starterContent.species.map(item => item.system.speciesKey));
    for (const key of ["earthling", "saiyan", "halfSaiyan", "namekian", "frostDemon", "android", "bioAndroid", "corePerson", "djinn", "majin", "alien"]) {
      assert(speciesKeys.has(key), `Missing starter species ${key}`);
    }
    const qualityKeys = new Set(game.dbzf.starterContent.qualities.map(item => item.system.key));
    for (const key of ["area", "bending", "burn", "deadly", "homing", "immobilization", "pull", "push", "rapid", "sealing", "selective", "slow", "super", "fullPower", "true", "duration", "multi", "penetrate"]) {
      assert(qualityKeys.has(key), `Missing starter quality ${key}`);
    }
  });

  await test("starter content can be created against schemas", async () => {
    const docs = [
      ...game.dbzf.starterContent.species,
      ...game.dbzf.starterContent.qualities,
      ...game.dbzf.starterContent.transformations,
      ...game.dbzf.starterContent.sampleItems
    ];
    const created = await Item.createDocuments(docs.map(doc => foundry.utils.deepClone(doc)));
    try {
      assert(created.length === docs.length, "Not all starter docs were created");
      const names = new Set(created.map(item => item.name));
      for (const doc of docs) assert(names.has(doc.name), `Missing starter item ${doc.name}`);
    } finally {
      await Item.deleteDocuments(created.map(item => item.id));
    }
  });

  await test("starter compendia can be seeded and contain content", async () => {
    assert(typeof game.dbzf.seedStarterCompendia === "function", "Compendium seeder API missing");
    assert(typeof game.dbzf.seedRulebookCompendium === "function", "Rulebook seeder API missing");
    const result = await game.dbzf.seedStarterCompendia();
    assert(result.summary.errors.length === 0, `Compendium seed errors: ${JSON.stringify(result.summary.errors)}`);

    const expected = {
      "dbz-fuzion-calibrated.species": game.dbzf.starterContent.species,
      "dbz-fuzion-calibrated.qualities": game.dbzf.starterContent.qualities,
      "dbz-fuzion-calibrated.transformations": game.dbzf.starterContent.transformations,
      "dbz-fuzion-calibrated.sample-items": game.dbzf.starterContent.sampleItems,
      "dbz-fuzion-calibrated.sample-actors": game.dbzf.starterContent.sampleActors
    };

    for (const [packId, docs] of Object.entries(expected)) {
      const pack = game.packs.get(packId);
      const index = await pack.getIndex({ fields: ["name", "type"] });
      const names = new Set(index.map(entry => entry.name));
      for (const doc of docs) assert(names.has(doc.name), `${packId} missing ${doc.name}`);
    }
  });

  await test("unified core rulebook journal can be seeded and indexed", async () => {
    const result = await game.dbzf.seedRulebookCompendium({ clearExisting: true });
    assert(!result.error, `Rulebook seed error: ${JSON.stringify(result)}`);
    assert(result.created === 1, "Unified rulebook should create exactly one JournalEntry", result);

    const pack = game.packs.get("dbz-fuzion-calibrated.core-rulebook");
    const index = await pack.getIndex({ fields: ["name"] });
    const names = new Set(index.map(entry => entry.name));
    assert(names.has("DBZRPG 2.5 Core Rulebook"), "Unified core rulebook entry missing");

    const docs = await pack.getDocuments();
    const rulebook = docs.find(doc => doc.name === "DBZRPG 2.5 Core Rulebook");
    assert(rulebook, "Unified rulebook document could not be loaded");
    assert(rulebook.pages.size === 12, "Clean unified rulebook should have 12 pages");

    const pageNames = [...rulebook.pages].map(page => page.name);
    for (const required of ["Character Creation", "Combat: Actions", "Techniques", "Species", "Equipment"]) {
      assert(pageNames.some(name => name.includes(required)), `Missing rulebook page containing ${required}`);
    }
    assert(!pageNames.some(name => /Implementation|Technical Notes/.test(name)), "Technical notes must not be player-facing rulebook pages");
  });
}
