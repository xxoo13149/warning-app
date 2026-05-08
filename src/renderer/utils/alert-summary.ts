import {
  buildAlertDetail as sharedBuildAlertDetail,
  buildAlertHeadline as sharedBuildAlertHeadline,
  buildAlertNotificationContent as sharedBuildAlertNotificationContent,
  buildAlertPresentation as sharedBuildAlertPresentation,
  buildAlertSummary as sharedBuildAlertSummary,
  buildAlertTitle as sharedBuildAlertTitle,
  getAlertCityLabel as sharedGetAlertCityLabel,
  getAlertRuleLabel as sharedGetAlertRuleLabel,
  type AlertFact,
  type AlertNotificationContent,
  type AlertPresentation,
  type AlertPresentationSource,
} from '../../shared/alert-presentation';

const SUMMARY_SEPARATOR = ' · ';

type AlertSummaryMetaKey = 'marketId' | 'temperatureBand' | 'rule';

export interface AlertSummaryMetaItem {
  key: AlertSummaryMetaKey;
  value: string;
}

export interface AlertSummaryDraft {
  presentation: AlertPresentation;
  notification: AlertNotificationContent;
  temperatureBand: string | null;
  marketId: string | null;
  primaryFact: AlertFact | null;
  visibleFacts: AlertFact[];
  detailText: string | null;
  objectSummary: string | null;
  triggerSummary: string;
  locatorTitle: string;
  locatorSubtitle: string | null;
  locatorMeta: AlertSummaryMetaItem[];
}

const buildAlertPresentationContextMatcher =
  (keyword: string) =>
  (label: string): boolean =>
    label.includes(keyword);

const findPresentationContextItem = (
  presentation: AlertPresentation,
  matcher: (label: string) => boolean,
) => presentation.context.find((item) => matcher(item.label)) ?? null;

const joinSummaryParts = (...parts: Array<string | null | undefined>) => {
  const value = parts
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(SUMMARY_SEPARATOR);
  return value || null;
};

const sanitizeDetailText = (
  detail: string | null,
  notificationBody: string,
  excludedLabels: string[],
) => {
  if (!detail) {
    return null;
  }

  const parts = detail
    .split(SUMMARY_SEPARATOR)
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.length > 0 &&
        !notificationBody.includes(part) &&
        !excludedLabels.some(
          (label) => part.startsWith(`${label}:`) || part.startsWith(`${label}：`),
        ),
    );

  return parts.length > 0 ? parts.join(SUMMARY_SEPARATOR) : null;
};

export const buildAlertDetail = sharedBuildAlertDetail;
export const buildAlertHeadline = sharedBuildAlertHeadline;
export const buildAlertNotificationContent = sharedBuildAlertNotificationContent;
export const buildAlertPresentation = sharedBuildAlertPresentation;
export const buildAlertSummary = sharedBuildAlertSummary;
export const buildAlertTitle = sharedBuildAlertTitle;
export const getAlertCityLabel = sharedGetAlertCityLabel;
export const getAlertRuleLabel = sharedGetAlertRuleLabel;

export const buildAlertSummaryDraft = (
  alert: AlertPresentationSource,
  options: { maxFacts?: number } = {},
): AlertSummaryDraft => {
  const presentation = buildAlertPresentation(alert);
  const notification = buildAlertNotificationContent(alert);
  const temperatureBandItem = findPresentationContextItem(
    presentation,
    buildAlertPresentationContextMatcher('温'),
  );
  const marketIdItem = findPresentationContextItem(
    presentation,
    buildAlertPresentationContextMatcher('盘口'),
  );
  const temperatureBand = temperatureBandItem?.value ?? null;
  const marketId = marketIdItem?.value ?? alert.marketId?.trim() ?? null;
  const primaryFact =
    presentation.facts.find((fact) => !notification.body.includes(fact.value)) ??
    presentation.facts[0] ??
    null;
  const maxFacts = options.maxFacts ?? 4;
  const visibleFacts = presentation.facts
    .filter((fact) => !notification.body.includes(fact.value))
    .slice(0, maxFacts);
  const detailText = sanitizeDetailText(presentation.detail, notification.body, [
    temperatureBandItem?.label ?? '',
    marketIdItem?.label ?? '',
  ]);
  const objectSummary = joinSummaryParts(
    presentation.cityLabel,
    temperatureBand,
    marketId ? `盘口 ${marketId}` : null,
  );
  const triggerSummary = primaryFact
    ? `${primaryFact.label} ${primaryFact.value}，触发 ${presentation.ruleLabel}`
    : `${notification.body}${
        notification.body.includes(presentation.ruleLabel) ? '' : `，触发 ${presentation.ruleLabel}`
      }`;
  const locatorTitle = marketId ?? temperatureBand ?? presentation.cityLabel;
  const locatorSubtitle = joinSummaryParts(presentation.cityLabel, temperatureBand);
  const locatorMeta = [
    ...(marketId ? [{ key: 'marketId' as const, value: marketId }] : []),
    ...(temperatureBand ? [{ key: 'temperatureBand' as const, value: temperatureBand }] : []),
    { key: 'rule' as const, value: presentation.ruleLabel },
  ];

  return {
    presentation,
    notification,
    temperatureBand,
    marketId,
    primaryFact,
    visibleFacts,
    detailText,
    objectSummary,
    triggerSummary,
    locatorTitle,
    locatorSubtitle,
    locatorMeta,
  };
};

export type {
  AlertFact,
  AlertNotificationContent,
  AlertPresentation,
  AlertPresentationSource,
};
