import { afterEach, describe, expect, it, vi } from "vitest";
import { Setting, makeFakeEl } from "./__mocks__/obsidian";
import { TransmuteSettingTab } from "../src/obsidian/settings-tab";
import { setLang } from "../src/vendor/kit/i18n";
import "../src/core/i18n/strings";

const DOCS = "https://github.com/johannes-kaindl/obsidian-transmute/blob/main/docs/README.md";
const ISSUES = "https://github.com/johannes-kaindl/obsidian-transmute/issues";

function makeTab(): TransmuteSettingTab {
  return new TransmuteSettingTab({} as never, { settings: {} } as never);
}

function renderFirst(tab: TransmuteSettingTab): Setting {
  const first = tab.getSettingDefinitions()[0] as unknown as { render: (s: Setting) => void };
  const setting = new Setting(makeFakeEl());
  first.render(setting);
  return setting;
}

describe("Hilfe-Zeile in den Einstellungen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setLang("en");
  });

  it("ist das ERSTE Element der Definitionen, vor jeder Gruppe", () => {
    const defs = tab().getSettingDefinitions() as unknown as { name?: string; type?: string }[];
    expect(defs[0]?.name).toBe("Help");
    expect(defs[0]?.type).toBeUndefined();
    expect(defs.slice(1).every((d) => d.type === "group")).toBe(true);
  });

  it("Text-Knopf öffnet den Doku-Index, Icon-Knopf die Issues dieses Repos", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const setting = renderFirst(makeTab());
    const [docs, bug] = setting.components as unknown as { textValue?: string; iconName?: string; tooltip?: string; clickCB: () => void }[];
    expect(docs?.textValue).toBe("Open documentation");
    docs?.clickCB();
    expect(open).toHaveBeenLastCalledWith(DOCS, "_blank", "noopener,noreferrer");
    expect(bug?.iconName).toBe("bug");
    expect(bug?.tooltip).toBe("Report an issue");
    bug?.clickCB();
    expect(open).toHaveBeenLastCalledWith(ISSUES, "_blank", "noopener,noreferrer");
  });

  it("trägt die deutschen Texte, wenn die Oberfläche deutsch ist", () => {
    setLang("de");
    const defs = makeTab().getSettingDefinitions() as unknown as { name?: string; desc?: string }[];
    expect(defs[0]?.name).toBe("Hilfe");
    expect(defs[0]?.desc).toBe("Erste Schritte, Anleitungen und Fehlersuche");
  });
});

function tab(): TransmuteSettingTab {
  return makeTab();
}
