/** Browser tab titles: "<page> · NR Industries" (the root layout's metadata template). */
export const TITLE_TEMPLATE = "%s · NR Industries";

export const tabTitle = (page: string) => TITLE_TEMPLATE.replace("%s", page);
