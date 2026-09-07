import { DBZFQARunner } from "./qa-runner.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function canUseQaTools() {
  if (game.user?.isGM) return true;
  ui.notifications?.warn("QA tools are GM only.");
  return false;
}

export class DBZFQAPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dbz-fuzion-calibrated-qa-panel",
    classes: ["dbzf-qa"],
    position: { width: 760, height: 640 },
    window: { title: "DBZ Fuzion Calibrated QA", resizable: true }
  };

  static PARTS = {
    panel: {
      template: "modules/dbz-fuzion-calibrated-qa/templates/qa-panel.hbs"
    }
  };

  constructor(options = {}) {
    super(options);
    this.runner = new DBZFQARunner();
    this.report = null;
  }

  render(options = {}) {
    if (!canUseQaTools()) return this;
    return super.render(options);
  }

  async _prepareContext(options) {
    if (!canUseQaTools()) return { isDbz: false, report: null };
    return {
      isDbz: game.system.id === "dbz-fuzion-calibrated",
      report: this.report
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.addEventListener("click", this.#onClick.bind(this));
  }

  async #onClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    event.preventDefault();
    if (!canUseQaTools()) return;

    const action = button.dataset.action;
    if (action === "close") return this.close();
    if (action === "cleanup") {
      const result = await this.runner.cleanupFixtures();
      ui.notifications.info(`QA fixtures cleaned: ${result.deletedActors} actors, ${result.deletedItems} items.`);
      return;
    }
    if (action === "export") return this.#exportReport();
    if (action === "seedCompendia") {
      if (typeof game.dbzf?.seedStarterCompendia !== "function") {
        ui.notifications.error("DBZ Fuzion compendium seeder is not available.");
        return;
      }
      const result = await game.dbzf.seedStarterCompendia();
      if (result.summary.errors.length) {
        ui.notifications.error(`Compendium seed completed with ${result.summary.errors.length} errors.`);
        console.warn("DBZ Fuzion Calibrated QA | Compendium seed errors", result.summary.errors);
      } else {
        ui.notifications.info(`Starter compendia seeded: ${result.summary.created} created, ${result.summary.skipped} already present.`);
      }
      return;
    }

    if (action === "all") this.report = await this.runner.runAll();
    else this.report = await this.runner.runGroup(action);
    if (this.rendered) this.render({ force: true });
  }

  #exportReport() {
    if (!this.runner.lastReport) {
      ui.notifications.warn("No QA report has been generated yet.");
      return;
    }
    const content = JSON.stringify(this.runner.lastReport, null, 2);
    foundry.utils.saveDataToFile(content, "application/json", `dbz-fuzion-calibrated-qa-${Date.now()}.json`);
  }
}
