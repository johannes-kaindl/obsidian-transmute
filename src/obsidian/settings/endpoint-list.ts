// Endpunkt-Zeilen-Editor. Schnitt uebernommen von yijing-oracle
// (src/obsidian/settings/endpoint-list.ts + src/core/settings/endpoint-editor-model.ts):
// duenne Render-Schicht, die Logik liegt pure in core/settings/endpoint-editor-model.ts.
import { Setting, setIcon } from "obsidian";
import {
  activeIndexFromStatuses,
  applyEndpointEdit,
  statusKindKey,
  warnRuleKey,
} from "../../core/settings/endpoint-editor-model";
import {
  ENDPOINT_PRESETS,
  validateEndpointInput,
  type EndpointStatus,
  type EndpointStatusKind,
} from "../../vendor/kit/endpoint_diagnostics";
import { t } from "../../vendor/kit/i18n";

export type EndpointListOpts = {
  list: string[];
  setList(next: string[]): void;
  probe(endpoint: string): Promise<EndpointStatus>;
  /** Nach einer Listen-Aenderung: speichern + Tab neu aufbauen. */
  commit(): void;
};

export function buildEndpointList(containerEl: HTMLElement, opts: EndpointListOpts): void {
  const statuses: (EndpointStatusKind | null)[] = opts.list.map(() => null);
  const statusEls: HTMLElement[] = [];
  const rows = [...opts.list, ""]; // letzte Leerzeile ist der Adder

  const commit = (next: string[]): void => {
    opts.setList(next);
    opts.commit();
  };

  rows.forEach((value, i) => {
    const isAdder = i >= opts.list.length;
    const setting = new Setting(containerEl);

    if (!isAdder) {
      // Status: Form UND Farbe UND Klasse UND aria-label (WCAG 1.4.1).
      const statusEl = setting.settingEl.createSpan({ cls: "transmute-ep-status is-checking" });
      setIcon(statusEl, "loader");
      statusEl.setAttribute("aria-label", t("set.epChecking"));
      statusEls.push(statusEl);
    }

    setting.addText((c) => {
      c.setValue(value);
      if (isAdder) c.setPlaceholder(t("set.epAdd"));
      // Commit auf blur, NICHT onChange: onChange feuert pro Tastendruck und wuerde im
      // Adder jeden Zwischenstand (h, ht, htt, …) als eigene Zeile anhaengen.
      c.inputEl.addEventListener("blur", () => {
        const next = applyEndpointEdit(opts.list, i, c.getValue(), isAdder);
        if (next.length === opts.list.length && next.every((e, k) => e === opts.list[k])) return;
        commit(next);
      });
    });

    if (!isAdder) {
      const warnings = validateEndpointInput(value);
      if (warnings.length > 0) {
        const warnEl = setting.settingEl.createSpan({ cls: "transmute-ep-warn" });
        setIcon(warnEl, "alert-triangle");
        warnEl.setAttribute("aria-label", warnings.map((w) => t(warnRuleKey(w.rule))).join(" · "));
      }
      // Das Status-Icon ist KEIN Loesch-Button — Loeschen laeuft ueber diesen Trash.
      // Die Zeile wird ueber ihren WERT aufgeloest, nicht ueber den Render-Index: ein
      // Blur-Commit einer anderen Zeile mutiert die Liste synchron, bevor der Klick laeuft.
      setting.addExtraButton((b) =>
        b
          .setIcon("trash-2")
          .setTooltip(t("set.epRemove"))
          .onClick(() => {
            const index = opts.list.indexOf(value);
            if (index >= 0) commit(applyEndpointEdit(opts.list, index, "", false));
          }),
      );
    }
  });

  const actions = new Setting(containerEl);
  for (const preset of ENDPOINT_PRESETS) {
    actions.addButton((b) =>
      b.setButtonText(preset.label).onClick(() => {
        if (!opts.list.includes(preset.url)) commit([...opts.list, preset.url]);
      }),
    );
  }
  actions.addButton((b) => b.setButtonText(t("set.epProbe")).onClick(() => opts.commit()));

  // Probe je Zeile; der erste erreichbare wird als aktiv markiert.
  opts.list.forEach((endpoint, i) => {
    void opts.probe(endpoint).then((status) => {
      statuses[i] = status.kind;
      const el = statusEls[i];
      if (el) {
        el.removeClass("is-checking", "is-ok", "is-error");
        setIcon(el, status.reachable ? "circle-check" : "circle-x");
        el.addClass(status.reachable ? "is-ok" : "is-error");
        // t(statusKindKey(...)) statt EndpointStatus.klartext — das Kit-Feld ist hart
        // deutsch und wuerde in der englischen Oberflaeche deutschen Text zeigen.
        el.setAttribute("aria-label", t(statusKindKey(status.kind)));
      }
      const active = activeIndexFromStatuses(statuses);
      statusEls.forEach((se, j) => se.toggleClass("is-active", j === active));
    });
  });
}
