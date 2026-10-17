// Translations of the panel's own text. The English text is the key: t("Delete") gives
// "Verwijderen" in Dutch, and any text without a translation (or any other language)
// stays English. Placeholders: t("{n} walls", { n: 3 }). The language follows the
// logged-in user's Home Assistant language (hass.language).
import panel from "./i18n/nl/panel.js";
import catalog from "./i18n/nl/catalog.js";
import views from "./i18n/nl/views.js";

const LANGUAGES = { nl: { ...catalog, ...views, ...panel } };

let language = "en";
let table = null;

/** Switch to a Home Assistant language code ("nl", "nl-BE", "en-GB"…); true when it changed. */
export function setLanguage(code) {
  const lang = String(code || "en").toLowerCase().split("-")[0];
  if (lang === language) return false;
  language = lang;
  table = LANGUAGES[lang] || null;
  return true;
}

export const currentLanguage = () => language;

/** The text in the current language, with {placeholders} filled in. */
export function t(text, vars) {
  let s = (table && table[text]) || text;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}
