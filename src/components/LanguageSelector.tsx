import { Languages } from "lucide-react";
import { STUDIO_LOCALES, type StudioLocale } from "../i18n/catalog";
import { useStudioLocale } from "../i18n/StudioLocale";

export function LanguageSelector() {
  const { locale, setLocale, t } = useStudioLocale();
  return (
    <label className="bd-language-selector" title={t("language.label")}>
      <Languages size={13} aria-hidden="true" />
      <span className="bd-visually-hidden">{t("language.label")}</span>
      <select
        aria-label={t("language.label")}
        value={locale}
        onChange={(event) => setLocale(event.target.value as StudioLocale)}
      >
        {STUDIO_LOCALES.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
        ))}
      </select>
    </label>
  );
}
