"""
yfinance FastAPI Mini-Service
Provides global stock market data via Yahoo Finance (yfinance)
Run: uvicorn main:app --host 0.0.0.0 --port 8001
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
from typing import Optional
import json
import math

app = FastAPI(title="yfinance Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def safe_float(val, default=None):
    """Convert value to float, handling NaN/Inf."""
    try:
        if val is None:
            return default
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return round(f, 4)
    except (TypeError, ValueError):
        return default


def safe_int(val, default=None):
    try:
        if val is None:
            return default
        return int(val)
    except (TypeError, ValueError):
        return default


def df_to_records(df: pd.DataFrame) -> list:
    """Convert dataframe to JSON-safe records."""
    records = []
    for idx, row in df.iterrows():
        record = {"date": str(idx)[:10]}
        for col in df.columns:
            record[col.lower()] = safe_float(row[col])
        records.append(record)
    return records


def compute_indicators(closes: list) -> dict:
    """Compute SMA20, SMA50, RSI14, MACD, Bollinger Bands."""
    indicators = {}

    if len(closes) >= 20:
        indicators["sma20"] = round(sum(closes[-20:]) / 20, 4)
    if len(closes) >= 50:
        indicators["sma50"] = round(sum(closes[-50:]) / 50, 4)

    # RSI 14
    if len(closes) >= 15:
        changes = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
        gains = [max(c, 0) for c in changes[-14:]]
        losses = [abs(min(c, 0)) for c in changes[-14:]]
        avg_gain = sum(gains) / 14
        avg_loss = sum(losses) / 14
        if avg_loss == 0:
            indicators["rsi"] = 100.0
        else:
            rs = avg_gain / avg_loss
            indicators["rsi"] = round(100 - (100 / (1 + rs)), 2)

    # Bollinger Bands (20-day)
    if len(closes) >= 20:
        sma = sum(closes[-20:]) / 20
        variance = sum((c - sma) ** 2 for c in closes[-20:]) / 20
        std = variance ** 0.5
        indicators["bb_upper"] = round(sma + 2 * std, 4)
        indicators["bb_lower"] = round(sma - 2 * std, 4)
        indicators["bb_mid"] = round(sma, 4)

    # MACD (12/26/9)
    def ema(data, period):
        k = 2 / (period + 1)
        result = [data[0]]
        for v in data[1:]:
            result.append(v * k + result[-1] * (1 - k))
        return result

    if len(closes) >= 26:
        ema12 = ema(closes, 12)
        ema26 = ema(closes, 26)
        macd_line = [e12 - e26 for e12, e26 in zip(ema12, ema26)]
        signal = ema(macd_line[-9:], 9) if len(macd_line) >= 9 else []
        if signal:
            indicators["macd"] = round(macd_line[-1], 4)
            indicators["macd_signal"] = round(signal[-1], 4)
            indicators["macd_hist"] = round(macd_line[-1] - signal[-1], 4)

    return indicators


@app.get("/health")
def health():
    return {"status": "ok", "service": "yfinance"}


@app.get("/quote/{symbol}")
def get_quote(symbol: str):
    """Get current quote data for a symbol."""
    try:
        ticker = yf.Ticker(symbol.upper())
        info = ticker.info

        return {
            "symbol": symbol.upper(),
            "name": info.get("longName") or info.get("shortName", symbol),
            "price": safe_float(info.get("regularMarketPrice") or info.get("currentPrice")),
            "previousClose": safe_float(info.get("previousClose")),
            "open": safe_float(info.get("regularMarketOpen") or info.get("open")),
            "dayHigh": safe_float(info.get("dayHigh") or info.get("regularMarketDayHigh")),
            "dayLow": safe_float(info.get("dayLow") or info.get("regularMarketDayLow")),
            "volume": safe_int(info.get("volume") or info.get("regularMarketVolume")),
            "avgVolume": safe_int(info.get("averageVolume")),
            "marketCap": safe_int(info.get("marketCap")),
            "peRatio": safe_float(info.get("trailingPE")),
            "forwardPE": safe_float(info.get("forwardPE")),
            "eps": safe_float(info.get("trailingEps")),
            "dividendYield": safe_float(info.get("dividendYield")),
            "52wHigh": safe_float(info.get("fiftyTwoWeekHigh")),
            "52wLow": safe_float(info.get("fiftyTwoWeekLow")),
            "beta": safe_float(info.get("beta")),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "country": info.get("country"),
            "currency": info.get("currency", "USD"),
            "exchange": info.get("exchange"),
            "shortRatio": safe_float(info.get("shortRatio")),
            "targetMeanPrice": safe_float(info.get("targetMeanPrice")),
            "recommendationKey": info.get("recommendationKey"),
            "numberOfAnalystOpinions": safe_int(info.get("numberOfAnalystOpinions")),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/history/{symbol}")
def get_history(
    symbol: str,
    period: str = Query("3mo", description="1mo, 3mo, 6mo, 1y, 2y, 5y"),
    interval: str = Query("1d", description="1d, 1wk, 1mo"),
):
    """Get historical price data with technical indicators."""
    try:
        ticker = yf.Ticker(symbol.upper())
        df = ticker.history(period=period, interval=interval)

        if df.empty:
            raise HTTPException(status_code=404, detail=f"No data for {symbol}")

        records = df_to_records(df)
        closes = [r["close"] for r in records if r.get("close") is not None]
        indicators = compute_indicators(closes)

        # Trend detection
        trend = "NEUTRAL"
        sma20 = indicators.get("sma20")
        sma50 = indicators.get("sma50")
        if sma20 and sma50:
            trend = "BULLISH" if sma20 > sma50 else "BEARISH"

        price_change = 0.0
        if closes and closes[0]:
            price_change = round((closes[-1] - closes[0]) / closes[0] * 100, 2)

        return {
            "symbol": symbol.upper(),
            "period": period,
            "interval": interval,
            "count": len(records),
            "historical": records[-60:],  # last 60 candles
            "indicators": indicators,
            "trend": trend,
            "priceChange": price_change,
            "lastPrice": safe_float(closes[-1]) if closes else None,
            "firstPrice": safe_float(closes[0]) if closes else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/financials/{symbol}")
def get_financials(symbol: str):
    """Get financial statements: income stmt, balance sheet, cash flow."""
    try:
        ticker = yf.Ticker(symbol.upper())

        def df_to_dict(df):
            if df is None or df.empty:
                return {}
            result = {}
            for col in df.columns:
                col_str = str(col)[:10]
                result[col_str] = {}
                for idx in df.index:
                    val = df.at[idx, col]
                    result[col_str][str(idx)] = safe_float(val)
            return result

        return {
            "symbol": symbol.upper(),
            "incomeStatement": df_to_dict(ticker.financials),
            "balanceSheet": df_to_dict(ticker.balance_sheet),
            "cashFlow": df_to_dict(ticker.cashflow),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/options/{symbol}")
def get_options(symbol: str):
    """Get options chain overview."""
    try:
        ticker = yf.Ticker(symbol.upper())
        expirations = ticker.options

        if not expirations:
            return {"symbol": symbol.upper(), "expirations": [], "chain": {}}

        # Get nearest expiration options
        nearest = expirations[0]
        chain = ticker.option_chain(nearest)

        def chain_df(df, limit=10):
            records = []
            for _, row in df.head(limit).iterrows():
                records.append({
                    "strike": safe_float(row.get("strike")),
                    "lastPrice": safe_float(row.get("lastPrice")),
                    "bid": safe_float(row.get("bid")),
                    "ask": safe_float(row.get("ask")),
                    "volume": safe_int(row.get("volume")),
                    "openInterest": safe_int(row.get("openInterest")),
                    "impliedVolatility": safe_float(row.get("impliedVolatility")),
                    "inTheMoney": bool(row.get("inTheMoney", False)),
                })
            return records

        return {
            "symbol": symbol.upper(),
            "expirations": list(expirations[:5]),
            "nearestExpiry": nearest,
            "calls": chain_df(chain.calls),
            "puts": chain_df(chain.puts),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/search")
def search_ticker(q: str = Query(..., description="Search query (e.g. Apple, AAPL)")):
    """Search for ticker symbols."""
    try:
        search = yf.Search(q, max_results=10)
        quotes = search.quotes or []
        return {
            "query": q,
            "results": [
                {
                    "symbol": item.get("symbol", ""),
                    "name": item.get("longname") or item.get("shortname", ""),
                    "exchange": item.get("exchange", ""),
                    "type": item.get("quoteType", ""),
                }
                for item in quotes
            ],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/compare")
def compare_stocks(
    symbols: str = Query(..., description="Comma-separated symbols e.g. AAPL,MSFT,GOOG"),
    period: str = Query("3mo"),
):
    """Compare multiple stocks - returns normalized performance."""
    try:
        symbol_list = [s.strip().upper() for s in symbols.split(",")][:6]
        results = {}

        for sym in symbol_list:
            try:
                ticker = yf.Ticker(sym)
                df = ticker.history(period=period, interval="1d")
                if not df.empty:
                    closes = df["Close"].dropna().tolist()
                    if closes:
                        base = closes[0]
                        normalized = [round((c / base - 1) * 100, 2) for c in closes]
                        results[sym] = {
                            "normalized": normalized,
                            "lastPrice": safe_float(closes[-1]),
                            "priceChange": round((closes[-1] / closes[0] - 1) * 100, 2),
                        }
            except Exception:
                pass

        return {"symbols": symbol_list, "period": period, "comparison": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
