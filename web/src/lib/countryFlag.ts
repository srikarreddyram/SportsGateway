/** ISO 3166-1 alpha-2 codes for the countries the mock provider's leagues use, plus the
 *  common footballing nations a real provider would add. Regional-indicator emoji need
 *  no image asset, which keeps this self-contained. */
const COUNTRY_CODES: Record<string, string> = {
  England: 'GB',
  Spain: 'ES',
  Italy: 'IT',
  Germany: 'DE',
  France: 'FR',
  Portugal: 'PT',
  Netherlands: 'NL',
  Brazil: 'BR',
  Argentina: 'AR',
  USA: 'US',
  Belgium: 'BE',
  Scotland: 'GB',
  Turkey: 'TR',
  World: 'UN',
};

function toFlagEmoji(code: string): string {
  if (code === 'UN') return '🌍';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}

export function countryFlag(country: string | null): string {
  if (!country) return '🌍';
  const code = COUNTRY_CODES[country];
  return code ? toFlagEmoji(code) : '🏳️';
}
