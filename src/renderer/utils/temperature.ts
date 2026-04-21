const DEGREE = '\u00B0';
const NAKED_UNIT_PATTERN = /[-+]?\d+(?:\.\d+)?\s*[cCfF](?![a-zA-Z])/g;
const TEMPERATURE_CONTEXT_PATTERN =
  /\b(?:temp(?:erature)?|forecast|degrees?|celsius|fahrenheit|above|below|under|over|between|from|through)\b/i;
const EXPLICIT_TEMPERATURE_GLYPH_PATTERN =
  /(?:\u2103|\u2109|(?:\u00B0|\u00BA|\u00C2|\uFFFD|\?)\s*[cCfF])/;

const normalizeSpecialUnits = (value: string): string =>
  value
    .replace(/\u2103/g, `${DEGREE}C`)
    .replace(/\u2109/g, `${DEGREE}F`);

const normalizeBrokenDegreeUnits = (value: string): string =>
  value
    .replace(/(?:\u00C2)?(?:\u00B0|\u00BA)\s*([cCfF])(?![a-zA-Z])/g, (_, unit: string) => `${DEGREE}${unit.toUpperCase()}`)
    .replace(/(?:\u00C2|\uFFFD|\?){1,4}\s*([cCfF])(?![a-zA-Z])/g, (_, unit: string) => `${DEGREE}${unit.toUpperCase()}`);

const injectDegreeBeforeNakedUnit = (value: string): string =>
  value.replace(/([-+]?\d+(?:\.\d+)?)\s*([cCfF])(?![a-zA-Z])/g, (_, numberPart: string, unit: string) => `${numberPart}${DEGREE}${unit.toUpperCase()}`);

const looksLikeTemperatureBand = (value: string): boolean => {
  if (EXPLICIT_TEMPERATURE_GLYPH_PATTERN.test(value)) {
    return true;
  }

  const nakedMatches = value.match(NAKED_UNIT_PATTERN);
  if (!nakedMatches) {
    return false;
  }

  if (nakedMatches.length > 1) {
    return true;
  }

  if (/^\s*[-+]?\d+(?:\.\d+)?\s*[cCfF]\s*$/.test(value)) {
    return true;
  }

  return TEMPERATURE_CONTEXT_PATTERN.test(value);
};

export const normalizeTemperatureBand = (value: string): string => {
  if (!value) {
    return value;
  }

  const compacted = value.replace(/\s{2,}/g, ' ').trim();
  if (!looksLikeTemperatureBand(compacted)) {
    return compacted;
  }

  const normalized = injectDegreeBeforeNakedUnit(
    normalizeBrokenDegreeUnits(normalizeSpecialUnits(compacted)),
  );

  return normalized.replace(/\s{2,}/g, ' ').trim();
};
