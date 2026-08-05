import { describe, expect, it, afterEach } from "vitest";
import { Setting, makeFakeEl } from "./__mocks__/obsidian";
import { buildEndpointList, type EndpointListOpts } from "../src/obsidian/settings/endpoint-list";
import type { EndpointConfig } from "../src/vendor/kit/endpoint_config";
import type { EndpointStatus } from "../src/vendor/kit/endpoint_diagnostics";
import "../src/core/i18n/strings";

// Setting/ExtraButtonComponent-Instanzen kommen aus buildEndpointList selbst — der Test
// hat keinen direkten Zugriff darauf. Wir haengen uns kurzzeitig an den Setting-Prototyp,
// um jede erzeugte Komponente in Render-Reihenfolge mitzuschreiben, und machen das danach
// wieder rueckgaengig.
const origAddExtraButton = Setting.prototype.addExtraButton;
const origAddText = Setting.prototype.addText;

function withCapturedComponents<T>(run: (texts: any[], extraButtons: any[]) => T): T {
  const texts: any[] = [];
  const extraButtons: any[] = [];
  Setting.prototype.addExtraButton = function (cb: any) {
    const result = origAddExtraButton.call(this, cb);
    extraButtons.push(this.components[this.components.length - 1]);
    return result;
  };
  Setting.prototype.addText = function (cb: any) {
    const result = origAddText.call(this, cb);
    texts.push(this.components[this.components.length - 1]);
    return result;
  };
  try {
    return run(texts, extraButtons);
  } finally {
    Setting.prototype.addExtraButton = origAddExtraButton;
    Setting.prototype.addText = origAddText;
  }
}

afterEach(() => {
  Setting.prototype.addExtraButton = origAddExtraButton;
  Setting.prototype.addText = origAddText;
});

const okStatus: EndpointStatus = { reachable: true, kind: "ok", klartext: "Verbunden" };

function render(list: EndpointConfig[]): {
  texts: any[];
  extraButtons: any[];
  commits: EndpointConfig[][];
} {
  const commits: EndpointConfig[][] = [];
  const opts: EndpointListOpts = {
    list,
    setList: (next) => commits.push(next),
    probe: async () => okStatus,
    commit: () => {},
  };
  return withCapturedComponents((texts, extraButtons) => {
    buildEndpointList(makeFakeEl(), opts);
    return { texts, extraButtons, commits };
  });
}

describe("buildEndpointList — Zeilen-Identitaet bei doppelter URL", () => {
  it("trifft mit dem Trash-Button der ZWEITEN Zeile die zweite, nicht die erste", () => {
    const list: EndpointConfig[] = [
      { url: "https://api.example.com", apiKey: "key-a" },
      { url: "https://api.example.com", apiKey: "key-b" },
    ];
    // Zeilen-Layout je Nicht-Adder-Zeile: addText(url), addText(apiKey), [addExtraButton(move)
    // nur ab i>0], addExtraButton(trash). Zeile 0 hat keinen Move-Button.
    const { extraButtons, commits } = render(list);
    expect(extraButtons).toHaveLength(3); // trash(0), move(1), trash(1)
    const trashRow1 = extraButtons[2];
    trashRow1.clickCB();

    expect(commits).toHaveLength(1);
    const next = commits[0];
    // Zeile 1 (key-b) muss weg sein, Zeile 0 (key-a) muss bleiben.
    expect(next).toEqual([{ url: "https://api.example.com", apiKey: "key-a" }]);
  });

  it("sortiert mit dem Move-Button der ZWEITEN Zeile die zweite nach vorn, nicht die erste", () => {
    const list: EndpointConfig[] = [
      { url: "https://api.example.com", apiKey: "key-a" },
      { url: "https://api.example.com", apiKey: "key-b" },
    ];
    const { extraButtons, commits } = render(list);
    const moveRow1 = extraButtons[1];
    moveRow1.clickCB();

    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual([
      { url: "https://api.example.com", apiKey: "key-b" },
      { url: "https://api.example.com", apiKey: "key-a" },
    ]);
  });

  it("editiert mit dem Schluesselfeld der ZWEITEN Zeile den Schluessel der zweiten, nicht der ersten", () => {
    const list: EndpointConfig[] = [
      { url: "https://api.example.com", apiKey: "key-a" },
      { url: "https://api.example.com", apiKey: "key-b" },
    ];
    // Text-Layout je Nicht-Adder-Zeile: addText(url), addText(apiKey). Zeile 0: texts[0..1],
    // Zeile 1: texts[2..3], Adder: texts[4].
    const { texts, commits } = render(list);
    const apiKeyFieldRow1 = texts[3];
    apiKeyFieldRow1.setValue("key-b-neu");
    const blurHandler = apiKeyFieldRow1.inputEl._listeners.blur[0];
    blurHandler();

    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual([
      { url: "https://api.example.com", apiKey: "key-a" },
      { url: "https://api.example.com", apiKey: "key-b-neu" },
    ]);
  });
});
