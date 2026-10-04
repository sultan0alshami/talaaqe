import { isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { CountryCodeSchema } from "@/lib/contracts/vocabulary";

export class SettingsError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); this.name = "SettingsError"; }
}

// Country selection concerns this phone number, independently of residence,
// interface language and the campaign's target markets.
export function normalizeSelectedPhone(input: string, selectedCountry: string): { phone: string; phoneCountryCode: string } {
  const country = CountryCodeSchema.safeParse(selectedCountry);
  if (!country.success || !isSupportedCountry(country.data as CountryCode) || typeof input !== "string" || input.length > 128) throw new SettingsError("INVALID_PHONE", 422);
  const parsed = parsePhoneNumberFromString(input.trim(), { defaultCountry: country.data as CountryCode, extract: false });
  if (!parsed || parsed.ext || !parsed.isValid() || parsed.country !== country.data) throw new SettingsError("INVALID_PHONE", 422);
  return { phone: parsed.number, phoneCountryCode: country.data };
}
