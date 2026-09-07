export async function runRollTests({ test, assert, createActor }) {
  await test("skill roll creates chat message", async () => {
    const actor = await createActor();
    const before = game.messages.size;
    await game.dbzf.rollSkill(actor, "fighting");
    assert(game.messages.size > before, "No chat message created");
  });
}
