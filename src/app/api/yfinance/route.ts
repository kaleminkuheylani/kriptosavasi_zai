import { NextRequest, NextResponse } from 'next/server';

// yfinance mini-service URL
const YFINANCE_SERVICE_URL = process.env.YFINANCE_SERVICE_URL || 'http://localhost:8001';

// Simple in-memory cache (per process)
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCached(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
}

async function proxyToService(path: string, params?: Record<string, string>): Promise<unknown> {
  const cacheKey = path + JSON.stringify(params || {});
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = new URL(`${YFINANCE_SERVICE_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const response = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`yfinance service error ${response.status}: ${err}`);
  }

  const data = await response.json();
  setCached(cacheKey, data);
  return data;
}

// GET /api/yfinance?action=quote&symbol=AAPL
// GET /api/yfinance?action=history&symbol=AAPL&period=3mo&interval=1d
// GET /api/yfinance?action=financials&symbol=AAPL
// GET /api/yfinance?action=options&symbol=AAPL
// GET /api/yfinance?action=search&q=Apple
// GET /api/yfinance?action=compare&symbols=AAPL,MSFT,GOOG&period=3mo
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    let data: unknown;

    switch (action) {
      case 'quote': {
        const symbol = searchParams.get('symbol');
        if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
        data = await proxyToService(`/quote/${symbol.toUpperCase()}`);
        break;
      }
      case 'history': {
        const symbol = searchParams.get('symbol');
        if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
        const period = searchParams.get('period') || '3mo';
        const interval = searchParams.get('interval') || '1d';
        data = await proxyToService(`/history/${symbol.toUpperCase()}`, { period, interval });
        break;
      }
      case 'financials': {
        const symbol = searchParams.get('symbol');
        if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
        data = await proxyToService(`/financials/${symbol.toUpperCase()}`);
        break;
      }
      case 'options': {
        const symbol = searchParams.get('symbol');
        if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
        data = await proxyToService(`/options/${symbol.toUpperCase()}`);
        break;
      }
      case 'search': {
        const q = searchParams.get('q');
        if (!q) return NextResponse.json({ error: 'q required' }, { status: 400 });
        data = await proxyToService('/search', { q });
        break;
      }
      case 'compare': {
        const symbols = searchParams.get('symbols');
        if (!symbols) return NextResponse.json({ error: 'symbols required' }, { status: 400 });
        const period = searchParams.get('period') || '3mo';
        data = await proxyToService('/compare', { symbols, period });
        break;
      }
      case 'health': {
        data = await proxyToService('/health');
        break;
      }
      default:
        return NextResponse.json(
          { error: 'Unknown action. Use: quote, history, financials, options, search, compare, health' },
          { status: 400 }
        );
    }

    return NextResponse.json(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Return structured error so the agent can handle it gracefully
    return NextResponse.json(
      { error: msg, service: 'yfinance', action },
      { status: 503 }
    );
  }
}
