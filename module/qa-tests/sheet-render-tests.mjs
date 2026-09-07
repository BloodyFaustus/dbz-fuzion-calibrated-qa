export async function runSheetRenderTests({ test, assert, createActor }) {
  await test("character sheet renders", async () => {
    const actor = await createActor();
    await actor.sheet.render(true);
    assert(actor.sheet.rendered, "Actor sheet did not render");
    actor.sheet.close();
  });

  await test("resource band uses responsive readable layout", async () => {
    const actor = await createActor("DBZF QA Responsive Sheet");
    const sheet = actor.sheet;
    await sheet.render(true);
    const element = sheet.element;
    const band = element.querySelector(".dbzf-header-stats");
    // Editable fields are what must stay usable; derived readouts next to them are allowed to be
    // as narrow as their content ("= 40"), so asserting a floor on those measures nothing.
    const controls = Array.from(element.querySelectorAll(".dbzf-header-stats input, .dbzf-hits-input"));
    assert(!!band, "Resource band missing");
    assert(controls.length > 0, "Resource controls missing");
    for (const control of controls) {
      assert(control.getBoundingClientRect().width >= 40, "Resource control width too small",
        { actual: `${control.name || control.className} = ${Math.round(control.getBoundingClientRect().width)}px` });
    }
    await sheet.close();
  });

  await test("sheet tabs render and swap panels without a re-render", async () => {
    const actor = await createActor("DBZF QA Tab Sheet");
    const sheet = actor.sheet;
    await sheet.render(true);
    const element = sheet.element;
    const tabs = Array.from(element.querySelectorAll(".dbzf-tab[data-tab]"));
    assert(tabs.length >= 5, "Expected at least five sheet tabs", { actual: tabs.length });
    const combatPanel = element.querySelector("[data-tab-panel='combat']");
    const characterPanel = element.querySelector("[data-tab-panel='character']");
    assert(!!combatPanel && !!characterPanel, "Tab panels missing");
    assert(combatPanel.hidden === false, "Combat panel should start visible");
    assert(characterPanel.hidden === true, "Character panel should start hidden");
    tabs.find(tab => tab.dataset.tab === "character")?.click();
    assert(characterPanel.hidden === false, "Character panel did not become visible");
    assert(combatPanel.hidden === true, "Combat panel did not hide");
    await sheet.close();
  });

  await test("icon sprite is injected with namespaced symbols", async () => {
    const sprite = document.getElementById("dbzf-icon-sprite");
    assert(!!sprite, "Icon sprite was not injected into the document");
    const symbols = sprite.querySelectorAll("symbol[id^='dbzf-']");
    assert(symbols.length >= 30, "Icon sprite is missing symbols", { actual: symbols.length });
    assert(!!sprite.querySelector("#dbzf-attack-power"), "Expected symbol #dbzf-attack-power");
  });

  await test("system stylesheet does not restyle Foundry outside the system", async () => {
    // Foundry v13 pulls system styles in as `@import url(...) layer(system)`, so the sheet is not a
    // top-level entry of document.styleSheets — it hangs off the importing rule.
    const findSheet = () => {
      for (const css of document.styleSheets) {
        if (String(css.href || "").includes("dbz-fuzion-calibrated.css")) return css;
        let rules = [];
        try { rules = Array.from(css.cssRules); } catch { continue; }
        for (const rule of rules) {
          if (rule.styleSheet && String(rule.href || "").includes("dbz-fuzion-calibrated.css")) return rule.styleSheet;
        }
      }
      return null;
    };
    const sheet = findSheet();
    assert(!!sheet, "System stylesheet not found");
    const offenders = [];
    const scan = rules => {
      for (const rule of rules) {
        if (rule.cssRules) { scan(rule.cssRules); continue; }
        const selector = rule.selectorText;
        if (!selector) continue;
        for (const part of selector.split(",").map(text => text.trim())) {
          // Every rule must be anchored to a dbzf class, the app class, or :root/@font-face.
          if (/(^|[\s>+~(])(\.dbzf|\.dbz-fuzion-calibrated)/.test(` ${part}`)) continue;
          if (/^:root$/.test(part)) continue;
          if (/^\.(journal-entry|journal-page)-content/.test(part)) continue;
          offenders.push(part);
        }
      }
    };
    scan(sheet.cssRules);
    assert(offenders.length === 0, "Unscoped selectors would restyle Foundry", { actual: offenders.slice(0, 8).join(" | ") });
  });
}
