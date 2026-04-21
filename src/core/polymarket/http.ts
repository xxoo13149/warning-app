import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetch as undiciFetch, type Dispatcher } from 'undici';

export interface RequestJsonOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  dispatcher?: Dispatcher;
}

const execFileAsync = promisify(execFile);
const FETCH_MAX_ATTEMPTS = 2;
const FALLBACK_MAX_BUFFER = 32 * 1024 * 1024;
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);
const POWERSHELL_HTTP_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$headers = @{}
if ($env:PM_HEADERS_B64) {
  $headersJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:PM_HEADERS_B64))
  if ($headersJson) {
    $headersObj = ConvertFrom-Json -InputObject $headersJson
    if ($headersObj -ne $null) {
      foreach ($property in $headersObj.PSObject.Properties) {
        $headers[$property.Name] = [string]$property.Value
      }
    }
  }
}

$params = @{
  Uri = $env:PM_URL
  Method = $env:PM_METHOD
  TimeoutSec = [int]$env:PM_TIMEOUT_SEC
  UseBasicParsing = $true
}

if ($headers.Count -gt 0) {
  $params['Headers'] = $headers
}

if ($env:PM_BODY_B64) {
  $body = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:PM_BODY_B64))
  $params['Body'] = $body
  if (-not $headers.ContainsKey('content-type') -and -not $headers.ContainsKey('Content-Type')) {
    $params['ContentType'] = 'application/json'
  }
}

$result = @{
  status = 0
  body = ''
  ok = $false
  message = ''
}

try {
  $response = Invoke-WebRequest @params
  $result.status = [int]$response.StatusCode
  $result.body = [string]$response.Content
  $result.ok = $true
} catch {
  $result.ok = $false
  $result.message = $_.Exception.Message
  if ($_.Exception.Response -ne $null) {
    try {
      $result.status = [int]$_.Exception.Response.StatusCode
    } catch {}
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      if ($stream -ne $null) {
        $reader = New-Object System.IO.StreamReader($stream)
        $result.body = [string]$reader.ReadToEnd()
        $reader.Dispose()
        $stream.Dispose()
      }
    } catch {}
  }
}

[Console]::Out.Write(($result | ConvertTo-Json -Compress))
`;

interface FetchResponsePayload {
  status: number;
  statusText: string;
  responseBody: string;
}

interface PowerShellResponsePayload {
  status?: number;
  body?: string;
  ok?: boolean;
  message?: string;
}

export class PolymarketHttpError extends Error {
  public readonly status?: number;
  public readonly url: string;
  public readonly responseBody?: string;

  public constructor(
    message: string,
    params: { url: string; status?: number; responseBody?: string },
  ) {
    super(message);
    this.name = 'PolymarketHttpError';
    this.status = params.status;
    this.url = params.url;
    this.responseBody = params.responseBody;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  if ('code' in error && typeof error.code === 'string') {
    return error.code;
  }

  if (
    'cause' in error &&
    error.cause &&
    typeof error.cause === 'object' &&
    'code' in error.cause &&
    typeof error.cause.code === 'string'
  ) {
    return error.cause.code;
  }

  return undefined;
}

function formatErrorSummary(error: unknown): string {
  if (!error) {
    return 'Unknown error';
  }

  if (error instanceof Error) {
    const code = getErrorCode(error);
    return code ? `${error.name}: ${error.message} (${code})` : `${error.name}: ${error.message}`;
  }

  return String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isRetryableNetworkError(error: unknown): boolean {
  if (
    error instanceof PolymarketHttpError &&
    error.status === undefined &&
    /timeout|request failed/i.test(error.message)
  ) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  if (isAbortError(error)) {
    return true;
  }

  const code = getErrorCode(error);
  if (code && RETRYABLE_NETWORK_CODES.has(code)) {
    return true;
  }

  return /fetch failed/i.test(error.message);
}

function shouldRetryHttpStatus(status: number): boolean {
  return RETRYABLE_HTTP_STATUSES.has(status);
}

function shouldUseWindowsFallback(error: unknown): boolean {
  return process.platform === 'win32' && isRetryableNetworkError(error);
}

async function requestViaFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
  dispatcher: Dispatcher | undefined,
): Promise<FetchResponsePayload> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await undiciFetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
      dispatcher,
    });

    return {
      status: response.status,
      statusText: response.statusText,
      responseBody: await response.text(),
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function parsePowerShellPayload(raw: string): PowerShellResponsePayload | null {
  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized) as PowerShellResponsePayload;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function requestViaPowerShell(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
): Promise<FetchResponsePayload> {
  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  const headersB64 = Buffer.from(JSON.stringify(headers), 'utf8').toString('base64');
  const bodyB64 = body ? Buffer.from(body, 'utf8').toString('base64') : '';

  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_HTTP_SCRIPT],
    {
      windowsHide: true,
      maxBuffer: FALLBACK_MAX_BUFFER,
      env: {
        ...process.env,
        PM_URL: url,
        PM_METHOD: method,
        PM_TIMEOUT_SEC: String(timeoutSec),
        PM_HEADERS_B64: headersB64,
        PM_BODY_B64: bodyB64,
      },
    },
  );

  const payload = parsePowerShellPayload(stdout);
  if (!payload) {
    throw new PolymarketHttpError('PowerShell fallback returned invalid payload', {
      url,
      responseBody: stderr || stdout,
    });
  }

  const status = typeof payload.status === 'number' ? payload.status : 0;
  if (status <= 0) {
    throw new PolymarketHttpError('PowerShell fallback transport failed', {
      url,
      responseBody: payload.message || stderr || 'Unknown fallback error',
    });
  }

  return {
    status,
    statusText: payload.message ?? '',
    responseBody: typeof payload.body === 'string' ? payload.body : '',
  };
}

function parseJsonOrThrow<T>(url: string, responseBody: string): T {
  try {
    return JSON.parse(responseBody) as T;
  } catch (error) {
    throw new PolymarketHttpError(`Invalid JSON response for ${url}`, {
      url,
      responseBody:
        error instanceof Error
          ? `${error.name}: ${error.message}; body=${responseBody.slice(0, 300)}`
          : responseBody.slice(0, 300),
    });
  }
}

export async function requestJson<T>(
  url: string,
  options: RequestJsonOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers = {
    'content-type': 'application/json',
    ...(options.headers ?? {}),
  };
  const body =
    options.body !== undefined ? JSON.stringify(options.body) : undefined;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await requestViaFetch(
        url,
        method,
        headers,
        body,
        timeoutMs,
        options.dispatcher,
      );

      if (response.status < 200 || response.status >= 300) {
        const httpError = new PolymarketHttpError(
          `HTTP ${response.status} for ${url}: ${response.statusText}`,
          {
            url,
            status: response.status,
            responseBody: response.responseBody,
          },
        );

        if (
          attempt < FETCH_MAX_ATTEMPTS &&
          shouldRetryHttpStatus(response.status)
        ) {
          await delay(250 * attempt);
          continue;
        }

        throw httpError;
      }

      return parseJsonOrThrow<T>(url, response.responseBody);
    } catch (error) {
      if (isAbortError(error)) {
        lastError = new PolymarketHttpError(
          `Request timeout after ${timeoutMs}ms`,
          {
            url,
          },
        );
      } else {
        lastError = error;
      }

      if (
        attempt < FETCH_MAX_ATTEMPTS &&
        isRetryableNetworkError(lastError)
      ) {
        await delay(250 * attempt);
        continue;
      }

      break;
    }
  }

  if (shouldUseWindowsFallback(lastError)) {
    try {
      const fallbackResponse = await requestViaPowerShell(
        url,
        method,
        headers,
        body,
        timeoutMs,
      );

      if (fallbackResponse.status < 200 || fallbackResponse.status >= 300) {
        throw new PolymarketHttpError(
          `HTTP ${fallbackResponse.status} for ${url}: ${fallbackResponse.statusText}`,
          {
            url,
            status: fallbackResponse.status,
            responseBody: fallbackResponse.responseBody,
          },
        );
      }

      return parseJsonOrThrow<T>(url, fallbackResponse.responseBody);
    } catch (fallbackError) {
      throw new PolymarketHttpError(
        'Request failed in fetch transport and Windows fallback transport',
        {
          url,
          responseBody: `primary=${formatErrorSummary(lastError)}; fallback=${formatErrorSummary(fallbackError)}`,
        },
      );
    }
  }

  if (lastError instanceof PolymarketHttpError) {
    throw lastError;
  }

  throw new PolymarketHttpError('Request failed', {
    url,
    responseBody: formatErrorSummary(lastError),
  });
}

export function toQueryString(params: Record<string, string | number | boolean>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    search.set(key, String(value));
  }

  return search.toString();
}

export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) {
    throw new Error('chunkSize must be greater than 0');
  }

  const result: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    result.push(items.slice(index, index + chunkSize));
  }

  return result;
}

export function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function toNumberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}
