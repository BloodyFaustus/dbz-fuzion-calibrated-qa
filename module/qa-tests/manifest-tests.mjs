export async function runManifestTests({ test, assert }) {
  await test("system id is dbz-fuzion-calibrated", () => {
    assert(game.system.id === "dbz-fuzion-calibrated", "System id mismatch", { actual: game.system.id });
  });

  await test("required item types exist", () => {
    const raw = game.system.documentTypes.Item;
    const types = Array.isArray(raw) ? raw : Object.keys(raw);
    for (const type of ["technique", "weapon", "armor", "equipment", "quality", "transformation", "species", "trait", "boost", "consumable"]) {
      assert(types.includes(type), `Missing item type ${type}`);
    }
  });

  await test("calibrated actors use only the core character sheet type", () => {
    const raw = game.system.documentTypes.Actor;
    const types = Array.isArray(raw) ? raw : Object.keys(raw);
    assert(types.includes("character"), "Character actor type missing");
    assert(!types.includes("npc"), "NPC actor type should not exist in calibrated fork");
  });

  await test("calibrated fork metadata is active", () => {
    assert(game.system.title === "DBZ Fuzion Redux - Calibrated GM Variant", "Calibrated system title mismatch", {
      actual: game.system.title
    });
    assert(game.modules.get("dbz-fuzion-calibrated-qa")?.active, "Calibrated QA module is not active");
  });
}
