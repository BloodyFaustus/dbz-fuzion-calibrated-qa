export async function runTravelTests({ test, assert, createActor }) {
  await test("max Mach and Mach 9 cost use Power Total", async () => {
    const actor = await createActor("QA Traveler");
    await actor.update({ "system.skills.power.rank": 80 });
    const travel = game.dbzf.calculateTravel(actor, { mach: 9, minutes: 10 });
    assert(travel.maxMach === 9, "Max Mach mismatch", travel);
    assert(travel.totalKiCost === 100, "Mach 9 cost mismatch", travel);
  });

  await test("partial duration rounds up to next interval", async () => {
    const actor = await createActor("QA Partial Traveler");
    await actor.update({ "system.skills.power.rank": 80 });
    const travel = game.dbzf.calculateTravel(actor, { mach: 9, minutes: 11 });
    assert(travel.intervals === 2, "Intervals should round up");
    assert(travel.totalKiCost === 200, "Rounded travel cost mismatch");
  });

  await test("Mach 5 for 30 minutes reports listed distance", async () => {
    const actor = await createActor("QA Distance Traveler");
    await actor.update({ "system.skills.power.rank": 80 });
    const travel = game.dbzf.calculateTravel(actor, { mach: 5, minutes: 30 });
    assert(travel.totalKiCost === 180, "Mach 5 30-minute cost mismatch", travel);
    assert(travel.miles === 1920, "Mach 5 miles mismatch", travel);
    assert(travel.km === 3090, "Mach 5 km mismatch", travel);
  });

  await test("travel spending subtracts charged Ki and refuses insufficient Ki", async () => {
    const actor = await createActor("QA Spend Traveler");
    await actor.update({ "system.skills.power.rank": 80, "system.resources.ki.value": 200, "system.resources.ki.charged": 200 });
    const travel = game.dbzf.calculateTravel(actor, { mach: 5, minutes: 30 });
    const spent = await game.dbzf.spendTravelKi(actor, travel);
    assert(!!spent, "Travel spend failed");
    assert(actor.system.resources.ki.charged === 20, "Travel Ki not spent");
    const refused = await game.dbzf.spendTravelKi(actor, travel);
    assert(refused === null, "Insufficient travel Ki should fail");
  });

  await test("travel dialog uses DialogV2 and its live preview recalculates", async () => {
    const actor = await createActor("DBZF QA Traveler UI");
    await actor.update({ "system.skills.power.rank": 40, "system.resources.ki.value": 2000, "system.resources.ki.charged": 2000 });
    const before = new Set(foundry.applications.instances.keys());
    game.dbzf.openTravelDialog(actor);
    await new Promise(resolve => setTimeout(resolve, 600));
    const app = Array.from(foundry.applications.instances.values()).find(x => !before.has(x.id));
    assert(!!app, "Travel dialog did not open");
    assert(app.constructor.name === "DialogV2", "Travel must use DialogV2 so it inherits system styling",
      { actual: app.constructor.name });
    const scope = app.element.querySelector(".dbzf-travel-scope");
    assert(!!scope, "Travel dialog body is missing its scope class");

    const select = scope.querySelector('[name="mach"]');
    select.value = "3";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const minutes = scope.querySelector('[name="minutes"]');
    minutes.value = "30";
    minutes.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 250));
    const read = key => scope.querySelector(`[data-preview="${key}"]`)?.textContent;
    assert(read("intervals") === "3", "Preview intervals did not recalculate", { actual: read("intervals") });
    assert(read("cost") === "120", "Preview Ki cost did not recalculate", { actual: read("cost") });
    assert(/1152 miles/.test(read("distance")), "Preview distance did not recalculate", { actual: read("distance") });
    app.element.remove();
    foundry.applications.instances.delete(app.id);
  });
}
