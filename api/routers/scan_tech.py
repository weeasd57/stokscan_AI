import os
from typing import Any, Dict, List, Optional, Tuple
from fastapi import APIRouter, HTTPException, Body, Request
from pydantic import BaseModel, field_validator
from eodhd import APIClient

import api.stock_ai as stock_ai
from api.stock_ai import (
    _init_supabase,
    add_technical_indicators,
    check_local_cache,
    get_company_fundamentals,
    get_stock_data_eodhd,
    is_ticker_synced,
    run_pipeline,
)
from api.symbols_local import load_symbols_for_country

router = APIRouter(prefix="/scan", tags=["scan"])


def _normalize_symbol_exchange(symbol: str, exchange: str) -> tuple[str, str]:
    return str(symbol or "").strip(), str(exchange or "").strip()


def _supabase_row_key(symbol: str, exchange: str) -> str:
    symbol, exchange = _normalize_symbol_exchange(symbol, exchange)
    return f"{symbol}|{exchange}"


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _fetch_latest_technical_indicators(symbol_pairs: List[tuple[str, str]]) -> Dict[str, Any]:
    _init_supabase()
    if not stock_ai.supabase:
        return {}

    tech_data: Dict[str, Any] = {}
    by_exchange: Dict[str, List[str]] = {}
    for symbol, exchange in symbol_pairs:
        symbol = str(symbol).strip()
        exchange = str(exchange).strip()
        if not symbol or not exchange:
            continue
        by_exchange.setdefault(exchange, []).append(symbol)

    for exchange, symbols in by_exchange.items():
        unique_symbols = list(dict.fromkeys(symbols))
        for i in range(0, len(unique_symbols), 200):
            chunk = unique_symbols[i:i + 200]
            try:
                query = (
                    stock_ai.supabase.table("stock_technical_indicators")
                    .select(
                        "symbol,exchange,date,close,volume,ema_50,ema_200,rsi_14,momentum_10,"
                        "atr_14,adx_14,stoch_k,stoch_d,cci_20,vwap_20,roc_12,vol_sma20,change_pct"
                    )
                    .in_("symbol", chunk)
                    .eq("exchange", exchange)
                    .order("date", desc=True)
                    .limit(max(1000, len(chunk) * 20))
                )
                res = query.execute()
                if res.data:
                    for row in res.data:
                        key = _supabase_row_key(row.get("symbol"), row.get("exchange"))
                        if key and key not in tech_data:
                            tech_data[key] = row
            except Exception as e:
                print(f"Supabase technical read failed for {exchange}: {e}")
    return tech_data


def _fetch_company_fundamentals(symbol_pairs: List[tuple[str, str]]) -> Dict[str, Any]:
    _init_supabase()
    if not stock_ai.supabase:
        return {}

    fundamentals: Dict[str, Any] = {}
    by_exchange: Dict[str, List[str]] = {}
    for symbol, exchange in symbol_pairs:
        symbol = str(symbol).strip()
        exchange = str(exchange).strip()
        if not symbol or not exchange:
            continue
        by_exchange.setdefault(exchange, []).append(symbol)

    for exchange, symbols in by_exchange.items():
        unique_symbols = list(dict.fromkeys(symbols))
        for i in range(0, len(unique_symbols), 200):
            chunk = unique_symbols[i:i + 200]
            try:
                res = (
                    stock_ai.supabase.table("stock_fundamentals")
                    .select("symbol,exchange,data")
                    .in_("symbol", chunk)
                    .eq("exchange", exchange)
                    .execute()
                )
                if res.data:
                    for row in res.data:
                        key = _supabase_row_key(row.get("symbol"), row.get("exchange"))
                        payload = row.get("data") or {}
                        if isinstance(payload, str):
                            try:
                                import json
                                payload = json.loads(payload)
                            except Exception:
                                payload = {}
                        fundamentals[key] = payload
            except Exception as e:
                print(f"Supabase fundamentals read failed for {exchange}: {e}")
    return fundamentals

class TechFilter(BaseModel):
    country: str = "Egypt"
    limit: int = 50
    rsi_min: Optional[float] = None
    rsi_max: Optional[float] = None
    min_price: Optional[float] = None
    above_ema50: bool = False
    above_ema200: bool = False
    below_ema50: bool = False
    adx_min: Optional[float] = None
    adx_max: Optional[float] = None
    atr_min: Optional[float] = None
    atr_max: Optional[float] = None
    stoch_k_min: Optional[float] = None
    stoch_k_max: Optional[float] = None
    roc_min: Optional[float] = None
    roc_max: Optional[float] = None
    above_vwap20: bool = False
    volume_above_sma20: bool = False
    # New Fundamental Filters
    market_cap_min: Optional[float] = None
    market_cap_max: Optional[float] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    golden_cross: bool = False
    use_ai_filter: bool = False
    min_ai_precision: float = 0.6

class TechResult(BaseModel):
    symbol: str
    name: str
    last_close: float
    rsi: float
    volume: float
    ema50: float
    ema200: float
    momentum: float
    atr14: float
    adx14: float
    stoch_k: float
    stoch_d: float
    cci20: float
    vwap20: float
    roc12: float
    vol_sma20: float
    # New Fundamental/Price Change Fields
    change_p: float = 0.0
    market_cap: Optional[float] = None
    pe_ratio: Optional[float] = None
    eps: Optional[float] = None
    dividend_yield: Optional[float] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    beta: Optional[float] = None
    ai_precision: Optional[float] = None
    ai_signal: Optional[str] = None
    logo_url: Optional[str] = None

    @field_validator('*', mode='before')
    def check_nan(cls, v):
        if isinstance(v, float) and (v != v):  # isnan
            return 0.0
        return v

class TechResponse(BaseModel):
    results: List[TechResult]
    scanned_count: int

class IndicatorDashboard(BaseModel):
    buy_signals: int
    sell_signals: int
    win_rate: float

class DashboardResponse(BaseModel):
    rsi: IndicatorDashboard
    macd: IndicatorDashboard
    ema: IndicatorDashboard
    bb: IndicatorDashboard
    scanned_count: int

@router.post("/technical", response_model=TechResponse)
async def scan_technical(
    request: Request,
    f: TechFilter = Body(...)
):
    api_key = os.getenv("EODHD_API_KEY")

    try:
        symbols_data = load_symbols_for_country(f.country)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"No symbols found for country: {f.country}")

    _init_supabase()
    symbols = []
    for row in symbols_data:
        symbol = str(row.get("Code", row.get("Symbol", ""))).strip()
        exchange = str(row.get("Exchange", "")).strip()
        if symbol and exchange:
            symbols.append((symbol, exchange))

    candidates = symbols_data[: min(len(symbols_data), max(f.limit * 3, 100))]
    scanned_count = len(candidates)
    results: List[TechResult] = []

    tech_rows: Dict[str, Any] = {}
    fundamentals_map: Dict[str, Any] = {}
    if stock_ai.supabase:
        tech_rows = _fetch_latest_technical_indicators(symbols[: min(len(symbols), max(f.limit * 3, 100))])
        if tech_rows:
            fundamentals_map = _fetch_company_fundamentals([tuple(key.split("|", 1)) for key in tech_rows.keys()])

    if tech_rows:
        for row in candidates:
            if await request.is_disconnected():
                print("Client disconnected, stopping scan_technical.")
                break

            symbol = str(row.get("Code", row.get("Symbol", ""))).strip()
            name = str(row.get("Name", "")).strip()
            exchange = str(row.get("Exchange", "")).strip()
            key = _supabase_row_key(symbol, exchange)
            tech = tech_rows.get(key)
            if not tech:
                continue

            close = _safe_float(tech.get("close"))
            rsi = _safe_float(tech.get("rsi_14"))
            ema50 = _safe_float(tech.get("ema_50"))
            ema200 = _safe_float(tech.get("ema_200"))
            volume = _safe_float(tech.get("volume"))
            momentum = _safe_float(tech.get("momentum_10"))
            atr14 = _safe_float(tech.get("atr_14"))
            adx14 = _safe_float(tech.get("adx_14"))
            stoch_k = _safe_float(tech.get("stoch_k"))
            stoch_d = _safe_float(tech.get("stoch_d"))
            cci20 = _safe_float(tech.get("cci_20"))
            vwap20 = _safe_float(tech.get("vwap_20"))
            roc12 = _safe_float(tech.get("roc_12"))
            vol_sma20 = _safe_float(tech.get("vol_sma20"))
            change_p = _safe_float(tech.get("change_pct"))

            funds = fundamentals_map.get(key) or {}
            m_cap = funds.get("marketCap")
            pe = funds.get("peRatio")
            eps_val = funds.get("eps")
            div_y = funds.get("dividendYield")
            sec = funds.get("sector")
            ind = funds.get("industry")
            beta_val = funds.get("beta")

            if f.market_cap_min is not None and (m_cap or 0) < f.market_cap_min:
                continue
            if f.market_cap_max is not None and (m_cap or 0) > f.market_cap_max:
                continue
            if f.sector and f.sector.lower() not in (sec or "").lower():
                continue
            if f.industry and f.industry.lower() not in (ind or "").lower():
                continue

            if f.min_price is not None and close < f.min_price:
                continue
            if f.rsi_min is not None and rsi < f.rsi_min:
                continue
            if f.rsi_max is not None and rsi > f.rsi_max:
                continue
            if f.above_ema50 and close <= ema50:
                continue
            if f.below_ema50 and close >= ema50:
                continue
            if f.above_ema200 and close <= ema200:
                continue
            if f.adx_min is not None and adx14 < f.adx_min:
                continue
            if f.adx_max is not None and adx14 > f.adx_max:
                continue
            if f.atr_min is not None and atr14 < f.atr_min:
                continue
            if f.atr_max is not None and atr14 > f.atr_max:
                continue
            if f.stoch_k_min is not None and stoch_k < f.stoch_k_min:
                continue
            if f.stoch_k_max is not None and stoch_k > f.stoch_k_max:
                continue
            if f.roc_min is not None and roc12 < f.roc_min:
                continue
            if f.roc_max is not None and roc12 > f.roc_max:
                continue
            if f.above_vwap20 and close <= vwap20:
                continue
            if f.volume_above_sma20 and volume <= vol_sma20:
                continue
            if f.golden_cross and ema50 <= ema200:
                continue

            ai_prec = None
            ai_sig = None
            if f.use_ai_filter:
                if not api_key:
                    raise HTTPException(status_code=500, detail="API Key not configured")
                try:
                    prediction = run_pipeline(
                        api_key=api_key,
                        ticker=symbol,
                        from_date="2020-01-01",
                        include_fundamentals=False,
                        tolerance_days=5,
                        exchange=exchange,
                        force_local=True,
                    )
                    if prediction.get("tomorrowPrediction") != 1:
                        continue
                    if prediction.get("precision", 0) < f.min_ai_precision:
                        continue
                    ai_prec = prediction.get("precision")
                    ai_sig = "BUY"
                except Exception:
                    continue

            results.append(TechResult(
                symbol=symbol,
                name=name,
                last_close=close,
                rsi=rsi,
                volume=volume,
                ema50=ema50,
                ema200=ema200,
                momentum=momentum,
                atr14=atr14,
                adx14=adx14,
                stoch_k=stoch_k,
                stoch_d=stoch_d,
                cci20=cci20,
                vwap20=vwap20,
                roc12=roc12,
                vol_sma20=vol_sma20,
                change_p=change_p,
                market_cap=m_cap,
                pe_ratio=pe,
                eps=eps_val,
                dividend_yield=div_y,
                sector=sec,
                industry=ind,
                beta=beta_val,
                ai_precision=ai_prec,
                ai_signal=ai_sig,
                logo_url=funds.get("logoUrl"),
            ))

            if len(results) >= f.limit:
                break

        return TechResponse(results=results, scanned_count=scanned_count)

    # Fallback to the original local/historical scan path if Supabase is unavailable or if the ready table is not populated.
    from api.stock_ai import get_cached_tickers
    try:
        cached_tickers = get_cached_tickers()
    except Exception:
        cached_tickers = set()
    
    cached_candidates = []
    others = []
    
    for row in symbols_data:
        sym = str(row.get("Code", row.get("Symbol", ""))).strip().upper()
        ex = str(row.get("Exchange", "")).strip().upper()
        if (sym, ex) in cached_tickers:
            cached_candidates.append(row)
        else:
            others.append(row)
            
    sorted_candidates = cached_candidates + others
    candidates = sorted_candidates[:f.limit]
    if not api_key:
        raise HTTPException(status_code=500, detail="API Key not configured")

    api = APIClient(api_key)
    
    results = []
    
    for row in candidates:
        if await request.is_disconnected():
            print("Client disconnected, stopping scan_technical.")
            break

        symbol = str(row.get("Code", row.get("Symbol", ""))).strip()
        name = str(row.get("Name", ""))
        exchange = str(row.get("Exchange", "")).strip()
        
        if not symbol or (symbol.upper(), exchange.upper()) not in cached_tickers:
            continue

        try:
            df = get_stock_data_eodhd(api, symbol, from_date="2023-01-01", tolerance_days=5, exchange=exchange, force_local=True)
            
            if df.empty: continue

            df = add_technical_indicators(df)
            if df.empty: continue

            last = df.iloc[-1]
            
            close = float(last.get("Close", 0))
            rsi = float(last.get("RSI", 0))
            ema50 = float(last.get("EMA_50", 0))
            ema200 = float(last.get("EMA_200", 0))
            volume = float(last.get("Volume", 0))
            momentum = float(last.get("Momentum", 0))
            atr14 = float(last.get("ATR_14", 0))
            adx14 = float(last.get("ADX_14", 0))
            stoch_k = float(last.get("STOCH_K", 0))
            stoch_d = float(last.get("STOCH_D", 0))
            cci20 = float(last.get("CCI_20", 0))
            vwap20 = float(last.get("VWAP_20", 0))
            roc12 = float(last.get("ROC_12", 0))
            vol_sma20 = float(last.get("VOL_SMA20", 0))

            prev_close = float(df.iloc[-2].get("Close", close)) if len(df) > 1 else close
            change_p = ((close - prev_close) / prev_close * 100) if prev_close != 0 else 0

            funds = get_company_fundamentals(symbol) or {}
            m_cap = funds.get("marketCap")
            pe = funds.get("peRatio")
            eps_val = funds.get("eps")
            div_y = funds.get("dividendYield")
            sec = funds.get("sector")
            ind = funds.get("industry")
            beta_val = funds.get("beta")

            if f.market_cap_min is not None and (m_cap or 0) < f.market_cap_min: continue
            if f.market_cap_max is not None and (m_cap or 0) > f.market_cap_max: continue
            if f.sector and f.sector.lower() not in (sec or "").lower(): continue
            if f.industry and f.industry.lower() not in (ind or "").lower(): continue

            if f.min_price is not None and close < f.min_price: continue
            if f.rsi_min is not None and rsi < f.rsi_min: continue
            if f.rsi_max is not None and rsi > f.rsi_max: continue
            if f.above_ema50 and close <= ema50: continue
            if f.below_ema50 and close >= ema50: continue
            if f.above_ema200 and close <= ema200: continue
            if f.adx_min is not None and adx14 < f.adx_min: continue
            if f.adx_max is not None and adx14 > f.adx_max: continue
            if f.atr_min is not None and atr14 < f.atr_min: continue
            if f.atr_max is not None and atr14 > f.atr_max: continue
            if f.stoch_k_min is not None and stoch_k < f.stoch_k_min: continue
            if f.stoch_k_max is not None and stoch_k > f.stoch_k_max: continue
            if f.roc_min is not None and roc12 < f.roc_min: continue
            if f.roc_max is not None and roc12 > f.roc_max: continue
            if f.above_vwap20 and close <= vwap20: continue
            if f.volume_above_sma20 and volume <= vol_sma20: continue
            if f.golden_cross and ema50 <= ema200: continue

            ai_prec = None
            ai_sig = None
            if f.use_ai_filter:
                try:
                    prediction = run_pipeline(
                        api_key=api_key,
                        ticker=symbol,
                        from_date="2020-01-01",
                        include_fundamentals=False,
                        tolerance_days=5,
                        exchange=exchange,
                        force_local=True
                    )
                    if prediction.get("tomorrowPrediction") != 1: continue
                    if prediction.get("precision", 0) < f.min_ai_precision: continue
                    ai_prec = prediction.get("precision")
                    ai_sig = "BUY"
                except Exception:
                    continue

            results.append(TechResult(
                symbol=symbol,
                name=name,
                last_close=close,
                rsi=rsi,
                volume=volume,
                ema50=ema50,
                ema200=ema200,
                momentum=momentum,
                atr14=atr14,
                adx14=adx14,
                stoch_k=stoch_k,
                stoch_d=stoch_d,
                cci20=cci20,
                vwap20=vwap20,
                roc12=roc12,
                vol_sma20=vol_sma20,
                change_p=change_p,
                market_cap=m_cap,
                pe_ratio=pe,
                eps=eps_val,
                dividend_yield=div_y,
                sector=sec,
                industry=ind,
                beta=beta_val,
                ai_precision=ai_prec,
                ai_signal=ai_sig,
                logo_url=funds.get("logoUrl")
            ))
        except Exception:
            continue

    return TechResponse(results=results, scanned_count=len(candidates))

@router.get("/dashboard", response_model=DashboardResponse)
async def get_scan_dashboard(request: Request, country: str = "Egypt", limit: int = 20, days: int = 60):
    """
    Returns aggregate indicator performance (win rates) across multiple symbols in a market.
    """
    api_key = os.getenv("EODHD_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="API Key not configured")

    try:
        symbols_data = load_symbols_for_country(country)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"No symbols found for country: {country}")

    # Prioritize cached symbols for speed
    candidates = []
    for row in symbols_data:
        sym = str(row.get("Code", row.get("Symbol", "")))
        ex = str(row.get("Exchange", ""))
        if check_local_cache(sym, ex):
            candidates.append(row)
        if len(candidates) >= limit:
            break
            
    if not candidates:
        # Fallback to first few if none in cache
        candidates = symbols_data[:5]

    api = APIClient(api_key)
    from api.lib.indicators import calculate_indicator_stats_v2
    from api.stock_ai import run_pipeline
    
    aggr = {
        "rsi": {"wins": 0, "total": 0, "buys": 0, "sells": 0},
        "macd": {"wins": 0, "total": 0, "buys": 0, "sells": 0},
        "ema": {"wins": 0, "total": 0, "buys": 0, "sells": 0},
        "bb": {"wins": 0, "total": 0, "buys": 0, "sells": 0},
    }

    scanned = 0
    for row in candidates:
        if await request.is_disconnected():
            break

        symbol = str(row.get("Code", row.get("Symbol", "")))
        exchange = str(row.get("Exchange", ""))
        
        try:
            # We need historical predictions to calculate WR
            # Using run_pipeline which handles fetching + technicals
            data = run_pipeline(api_key, symbol, exchange=exchange, include_fundamentals=False)
            if not data or "testPredictions" not in data: continue
            
            # Filter by days if specified
            predictions = data["testPredictions"]
            if days > 0:
                predictions = predictions[-days:]
            
            stats = calculate_indicator_stats_v2(predictions)
            
            for key in aggr:
                s = stats.get(key)
                if s:
                    aggr[key]["buys"] += s.get("buySignals", 0)
                    aggr[key]["sells"] += s.get("sellSignals", 0)
                    total_signals = s.get("buySignals", 0) # Only tracking buys for winrate in aggr currently
                    if total_signals > 0:
                        wr = float(s.get("buyWinRate", 0)) / 100.0
                        aggr[key]["wins"] += (wr * total_signals)
                        aggr[key]["total"] += total_signals

            scanned += 1
        except Exception:
            continue

    def build_dashboard(key):
        total = aggr[key]["total"]
        win_rate = (aggr[key]["wins"] / total * 100) if total > 0 else 0
        return IndicatorDashboard(
            buy_signals=aggr[key]["buys"],
            sell_signals=aggr[key]["sells"],
            win_rate=round(win_rate, 1)
        )

    return DashboardResponse(
        rsi=build_dashboard("rsi"),
        macd=build_dashboard("macd"),
        ema=build_dashboard("ema"),
        bb=build_dashboard("bb"),
        scanned_count=scanned
    )

class CreateAlertRequest(BaseModel):
    user_id: str
    name: str
    filters: TechFilter

class AlertToggleRequest(BaseModel):
    is_active: bool

@router.post("/alerts")
async def create_alert(req: CreateAlertRequest):
    try:
        _init_supabase()
        if not stock_ai.supabase:
            raise HTTPException(status_code=500, detail="Supabase not initialized")
            
        payload = {
            "user_id": req.user_id,
            "name": req.name,
            "filters": req.filters.dict(exclude_none=True),
            "is_active": True
        }
        res = stock_ai.supabase.table("technical_alerts").insert(payload).execute()
        if not res.data:
            raise HTTPException(status_code=400, detail="Failed to save alert")
        return res.data[0]
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/alerts")
async def list_alerts(user_id: str):
    try:
        _init_supabase()
        if not stock_ai.supabase:
            raise HTTPException(status_code=500, detail="Supabase not initialized")
            
        res = stock_ai.supabase.table("technical_alerts").select("*").eq("user_id", user_id).execute()
        return {"alerts": res.data or []}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/alerts/{alert_id}")
async def delete_alert(alert_id: str):
    try:
        _init_supabase()
        if not stock_ai.supabase:
            raise HTTPException(status_code=500, detail="Supabase not initialized")
            
        res = stock_ai.supabase.table("technical_alerts").delete().eq("id", alert_id).execute()
        return {"status": "deleted"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.patch("/alerts/{alert_id}")
async def toggle_alert(alert_id: str, req: AlertToggleRequest):
    try:
        _init_supabase()
        if not stock_ai.supabase:
            raise HTTPException(status_code=500, detail="Supabase not initialized")
            
        res = stock_ai.supabase.table("technical_alerts").update({"is_active": req.is_active}).eq("id", alert_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Alert not found")
        return res.data[0]
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

