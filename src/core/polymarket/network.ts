import type { Agent as HttpAgent } from 'node:http';

// eslint-disable-next-line import/no-unresolved
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyAgent, type Dispatcher } from 'undici';

function normalizeProxyUrl(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^[a-z]+:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `http://${trimmed}`;
}

export function buildUndiciDispatcher(
  proxyUrl: string | null | undefined,
): Dispatcher | undefined {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) {
    return undefined;
  }

  return new ProxyAgent(normalized);
}

export function buildWsAgent(
  proxyUrl: string | null | undefined,
): HttpAgent | undefined {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) {
    return undefined;
  }

  return new HttpsProxyAgent(normalized);
}
