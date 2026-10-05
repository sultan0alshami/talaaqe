import { COUNTRY_CODES } from "@/lib/contracts/vocabulary";
import type { Lang } from "@/lib/lang";

export type DiscoveryCountryOption = { code: (typeof COUNTRY_CODES)[number]; name: string };
export type DiscoveryCountryOptions = Record<Lang, DiscoveryCountryOption[]>;

// Compute the ordered bilingual UI labels on the server and serialize them.
// Node and browser ICU versions can differ in both names and collation.
export function discoveryCountryOptions(): DiscoveryCountryOptions {
  const options = (lang: Lang) => {
    const names = new Intl.DisplayNames([lang], { type: "region" });
    return COUNTRY_CODES.map(code => ({ code, name: names.of(code) ?? code }))
      .sort((left, right) => left.name.localeCompare(right.name, lang));
  };
  return { ar: options("ar"), en: options("en") };
}
