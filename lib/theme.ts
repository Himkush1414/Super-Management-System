/** The dashboard's colour theme: dark by default, light on request. */
export type Theme = "dark" | "light";

/** localStorage key holding the choice ("light"; anything else = dark). */
export const THEME_KEY = "nr-theme";

/**
 * Runs inline in <head> on every full page load, before the first paint:
 * a dashboard page whose viewer chose light mode gets data-theme="light" on
 * <html>, so it never flashes dark first. Other pages stay dark.
 */
export const THEME_SCRIPT = `(function(){try{if(location.pathname.indexOf("/dashboard")===0&&localStorage.getItem(${JSON.stringify(THEME_KEY)})==="light")document.documentElement.setAttribute("data-theme","light")}catch(e){}})()`;
