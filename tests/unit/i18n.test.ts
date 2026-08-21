import { describe, expect, it } from "vitest";
import {
  isStudioLocale,
  STUDIO_LOCALES,
  translateStudioCommand,
  translateStudioMessage,
} from "../../src/i18n/catalog";

describe("studio locale catalog", () => {
  it("defines exactly the five supported desktop languages", () => {
    expect(STUDIO_LOCALES.map((locale) => locale.id)).toEqual(["en", "zh-CN", "fr", "ja", "ko"]);
    STUDIO_LOCALES.forEach((locale) => expect(isStudioLocale(locale.id)).toBe(true));
    expect(isStudioLocale("de")).toBe(false);
  });

  it("interpolates shell messages and localizes command projections", () => {
    expect(translateStudioMessage("ko", "status.blocks", { count: 12 })).toBe("다이어그램 모듈 12개");
    expect(translateStudioMessage("fr", "status.viewRoot", { title: "Système" })).toBe("Racine de la vue : Système");
    expect(translateStudioCommand("ja", "addPort", "Add Port...")).toBe("ポートを追加…");
  });

  it("preserves an explicit fallback for unknown extension commands", () => {
    expect(translateStudioCommand("zh-CN", "plugin.command", "Plugin command")).toBe("Plugin command");
  });
});
