import { execFileSync } from 'node:child_process';

const ENV_PROXY_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const;

function normalizeProxyUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^[a-z]+:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `http://${trimmed}`;
}

function parseRegistryValue(output: string, key: string): string | null {
  const pattern = new RegExp(`${key}\\s+REG_\\w+\\s+(.+)$`, 'im');
  const match = output.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function pickProxyServer(proxyServer: string): string | null {
  const entries = proxyServer
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    return null;
  }

  if (entries.length === 1 && !entries[0].includes('=')) {
    return normalizeProxyUrl(entries[0]);
  }

  const byProtocol = new Map<string, string>();
  for (const entry of entries) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex === -1) {
      if (!byProtocol.has('https')) {
        byProtocol.set('https', entry);
      }
      continue;
    }

    const protocol = entry.slice(0, separatorIndex).trim().toLowerCase();
    const address = entry.slice(separatorIndex + 1).trim();
    if (!protocol || !address) {
      continue;
    }
    byProtocol.set(protocol, address);
  }

  return (
    normalizeProxyUrl(byProtocol.get('https') ?? '') ??
    normalizeProxyUrl(byProtocol.get('http') ?? '') ??
    normalizeProxyUrl(entries[0])
  );
}

export function detectSystemProxyUrl(): string | null {
  for (const key of ENV_PROXY_KEYS) {
    const candidate = normalizeProxyUrl(process.env[key] ?? '');
    if (candidate) {
      return candidate;
    }
  }

  if (process.platform !== 'win32') {
    return null;
  }

  try {
    const enableOutput = execFileSync(
      'reg.exe',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
        '/v',
        'ProxyEnable',
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    const enabled = parseRegistryValue(enableOutput, 'ProxyEnable');
    if (!enabled || !enabled.endsWith('0x1')) {
      return null;
    }

    const proxyOutput = execFileSync(
      'reg.exe',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
        '/v',
        'ProxyServer',
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    const proxyServer = parseRegistryValue(proxyOutput, 'ProxyServer');
    return proxyServer ? pickProxyServer(proxyServer) : null;
  } catch {
    return null;
  }
}
