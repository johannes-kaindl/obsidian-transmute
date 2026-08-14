import { Modal, type App } from "obsidian";
import { t } from "../vendor/kit/i18n";

/** Die letzte Nachfrage vor einer vault-weiten Aenderung. */
export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly files: number,
    private readonly hits: number,
    private readonly onConfirm: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText(t("view.confirmTitle", String(this.files)));
    this.contentEl.createEl("p", {
      text: t("view.confirmBody", String(this.hits), String(this.files)),
    });
    const row = this.contentEl.createDiv({ cls: "transmute-confirm-row" });
    const cancel = row.createEl("button", { text: t("view.cancel") });
    cancel.onclick = (): void => this.close();
    const ok = row.createEl("button", { cls: "mod-cta", text: t("view.confirmApply") });
    ok.onclick = (): void => { this.close(); this.onConfirm(); };
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
