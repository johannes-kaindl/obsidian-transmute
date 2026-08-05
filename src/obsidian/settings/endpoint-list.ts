// Endpunkt-Zeilen-Editor. Schnitt uebernommen von yijing-oracle
// (src/obsidian/settings/endpoint-list.ts + src/core/settings/endpoint-editor-model.ts):
// duenne Render-Schicht, die Logik liegt pure in core/settings/endpoint-editor-model.ts
// bzw. im Kit (endpoint_config.ts).
import { Setting, setIcon } from "obsidian";
import {
  activeIndexFromStatuses,
  roleKindKey,
  statusKindKey,
  warnRuleKey,
} from "../../core/settings/endpoint-editor-model";
import {
  applyEndpointEdit,
  moveEndpointToFront,
  endpointRole,
  carriesApiKey,
  type EndpointConfig,
} from "../../vendor/kit/endpoint_config";
import {
  ENDPOINT_PRESETS,
  validateEndpointInput,
  type EndpointStatus,
  type EndpointStatusKind,
} from "../../vendor/kit/endpoint_diagnostics";
import { t } from "../../vendor/kit/i18n";

export type EndpointListOpts = {
  list: EndpointConfig[];
  setList(next: EndpointConfig[]): void;
  probe(ep: EndpointConfig): Promise<EndpointStatus>;
  /** Nach einer Listen-Aenderung: speichern + Tab neu aufbauen. */
  commit(): void;
};

export function buildEndpointList(containerEl: HTMLElement, opts: EndpointListOpts): void {
  const statuses: (EndpointStatusKind | null)[] = opts.list.map(() => null);
  const statusEls: HTMLElement[] = [];
  const roleEls: HTMLElement[] = [];
  const rows: EndpointConfig[] = [...opts.list, { url: "" }]; // letzte Leerzeile ist der Adder

  const commit = (next: EndpointConfig[]): void => {
    opts.setList(next);
    opts.commit();
  };

  rows.forEach((cfg, i) => {
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
      c.setValue(cfg.url);
      if (isAdder) c.setPlaceholder(t("set.epAdd"));
      // Commit auf blur, NICHT onChange: onChange feuert pro Tastendruck und wuerde im
      // Adder jeden Zwischenstand (h, ht, htt, …) als eigene Zeile anhaengen.
      c.inputEl.addEventListener("blur", () => {
        const next = applyEndpointEdit(opts.list, i, "url", c.getValue(), isAdder);
        if (JSON.stringify(next) === JSON.stringify(opts.list)) return;
        commit(next);
      });
    });

    if (!isAdder) {
      setting.addText((c) => {
        c.setValue(cfg.apiKey ?? "");
        c.setPlaceholder(t("set.epKeyPlaceholder"));
        c.inputEl.type = "password"; // maskiert — der Schluessel steht nie im Klartext
        c.inputEl.setAttribute("aria-label", t("set.epKey"));
        c.inputEl.addEventListener("blur", () => {
          const next = applyEndpointEdit(opts.list, i, "apiKey", c.getValue(), false);
          if (JSON.stringify(next) === JSON.stringify(opts.list)) return;
          commit(next);
        });
      });

      if (carriesApiKey(cfg)) {
        // Form/Icon + Tooltip, nie Farbe allein (WCAG 1.4.1). Der Schluessel selbst
        // erscheint nirgends im Text.
        const mark = setting.settingEl.createSpan({ cls: "transmute-ep-thirdparty" });
        setIcon(mark, "alert-triangle");
        mark.setAttribute("aria-label", t("set.epThirdParty"));
        mark.setAttribute("title", t("set.epThirdParty"));
      }

      const warnings = validateEndpointInput(cfg.url);
      if (warnings.length > 0) {
        const warnEl = setting.settingEl.createSpan({ cls: "transmute-ep-warn" });
        setIcon(warnEl, "alert-triangle");
        warnEl.setAttribute("aria-label", warnings.map((w) => t(warnRuleKey(w.rule))).join(" · "));
      }

      // Ab Zeile 2 GAR NICHT gezeichnet statt an Platz 1 deaktiviert: ein setDisabled-
      // Tooltip bleibt in Electron unsichtbar — der Nutzer saehe einen toten Knopf ohne
      // Erklaerung (gemessen in vault-rag 0.20.0).
      if (i > 0) {
        setting.addExtraButton((b) =>
          b
            .setIcon("chevrons-up")
            .setTooltip(t("set.epMoveToFront"))
            .onClick(() => {
              const index = opts.list.findIndex((e) => e.url === cfg.url);
              if (index > 0) commit(moveEndpointToFront(opts.list, index));
            }),
        );
      }

      const roleEl = setting.settingEl.createSpan({ cls: "transmute-ep-role" });
      roleEls.push(roleEl);

      // Das Status-Icon ist KEIN Loesch-Button — Loeschen laeuft ueber diesen Trash.
      // Ueber die URL aufloesen, nicht ueber den Render-Index und nicht ueber indexOf:
      // ein Blur-Commit einer anderen Zeile mutiert die Liste synchron, bevor der Klick
      // laeuft — und indexOf vergliche bei Objekten Referenzen, die nach einem Commit
      // nicht mehr dieselben sind.
      setting.addExtraButton((b) =>
        b
          .setIcon("trash-2")
          .setTooltip(t("set.epRemove"))
          .onClick(() => {
            const index = opts.list.findIndex((e) => e.url === cfg.url);
            if (index >= 0) commit(applyEndpointEdit(opts.list, index, "url", "", false));
          }),
      );
    }
  });

  const actions = new Setting(containerEl);
  for (const preset of ENDPOINT_PRESETS) {
    actions.addButton((b) =>
      b.setButtonText(preset.label).onClick(() => {
        if (!opts.list.some((e) => e.url === preset.url)) commit([...opts.list, { url: preset.url }]);
      }),
    );
  }
  actions.addButton((b) => b.setButtonText(t("set.epProbe")).onClick(() => opts.commit()));

  // Probe je Zeile; der erste erreichbare wird als aktiv markiert.
  opts.list.forEach((cfg, i) => {
    void opts.probe(cfg).then((status) => {
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

      // Rollen-Text je Zeile neu rechnen — nicht nur fuer die gerade geprobte: der aktive
      // Endpunkt wechselt, sobald eine fruehere Zeile antwortet, und alle spaeteren
      // Zeilen aendern damit ihre Position. Wer nur die eigene Zeile aktualisiert, laesst
      // die anderen einen veralteten Zustand behaupten.
      roleEls.forEach((re, j) => {
        const role = endpointRole({
          isActive: j === active,
          reachable: statuses[j] === "ok",
          modelFits: true, // kein Embedding-Index in diesem Plugin
          position: j + 1,
        });
        re.setText(t(roleKindKey(role), String(j + 1)));
        re.toggleClass("is-active", role.kind === "active");
      });
    });
  });
}
