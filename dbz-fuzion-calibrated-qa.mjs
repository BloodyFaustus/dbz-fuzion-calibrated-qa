import { DBZFQAPanel } from "./module/qa-ui.mjs";

export const DBZF_QA_MODULE_ID = "dbz-fuzion-calibrated-qa";
export const DBZF_QA_FIXTURE_SETTING = "trackedFixtures";

Hooks.once("init", () => {
  game.settings.register(DBZF_QA_MODULE_ID, DBZF_QA_FIXTURE_SETTING, {
    name: "Tracked QA Fixtures",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.registerMenu(DBZF_QA_MODULE_ID, "panel", {
    name: "DBZ Fuzion Calibrated QA",
    label: "Open QA Panel",
    hint: "Run DBZ Fuzion system tests.",
    icon: "fas fa-vial",
    type: DBZFQAPanel,
    restricted: true
  });
});

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  if (game.system.id !== "dbz-fuzion-calibrated") {
    ui.notifications.warn("DBZ Fuzion Calibrated QA is active outside the dbz-fuzion-calibrated system.");
    return;
  }
  ui.notifications.info("DBZ Fuzion Calibrated QA ready. Open it from Configure Settings.");
});
