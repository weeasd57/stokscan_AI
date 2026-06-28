import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from api.stock_ai import _get_exchange_bulk_data, check_local_cache, run_pipeline
from api.symbols_local import load_symbols_for_country

router = APIRouter(prefix="/scan", tags=["scan"])


class ScanResult(BaseModel):
    symbol: str
    exchange: Optional[str] = None
    name: str
    last_close: float
    precision: float
    signal: str  # "BUY" or "SELL/HOLD"
    confidence: str  # High/Medium/Low based on precision
    logo_url: Optional[str] = None
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None


class SingleScanRequest(BaseModel):
    symbol: str
    exchange: Optional[str] = None
    min_precision: float = 0.6
    rf_preset: Optional[str] = "fast"
    rf_params: Optional[Dict[str, Any]] = None
    model_name: Optional[str] = None


class ScanAiOptions(BaseModel):
    rf_preset: Optional[str] = "fast"
    rf_params: Optional[Dict[str, Any]] = None
    model_name: Optional[str] = None


class ScanResponse(BaseModel):
    results: List[ScanResult]
    scanned_count: int


@router.post("/ai", response_model=ScanResponse)
async def scan_ai(
    request: Request,
    country: str = Query(default="Egypt", description="Country to scan"),
    limit: int = Query(default=50, ge=1, le=200, description="Max symbols to scan"),
    min_precision: float = Query(
        default=0.6, ge=0.0, le=1.0, description="Min precision to include"
    ),
    opts: Optional[ScanAiOptions] = None,
):
    api_key = os.getenv("EODHD_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="API Key not configured")

    try:
        symbols_data = load_symbols_for_country(country)
    except FileNotFoundError:
        raise HTTPException(
            status_code=404, detail=f"No symbols found for country: {country}"
        )
    except Exception as e:
        # If model_name specified but not found, surface clear error
        if opts and opts.model_name and "not loaded" in str(e):
            raise HTTPException(
                status_code=400,
                detail=f"Model '{opts.model_name}' not loaded on server. Place the .pkl and retry.",
            )
        print(f"scan_ai: failed loading symbols for {country}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # Warm bulk cache per exchange to avoid N Supabase queries
    try:
        exchanges = {
            str(row.get("Exchange", "")).upper()
            for row in symbols_data
            if isinstance(row, dict)
        }
        for ex in exchanges:
            if not ex:
                continue
            _get_exchange_bulk_data(ex, from_date="2020-01-01")
    except Exception as e:
        print(f"scan_ai: bulk warmup skipped: {e}")

    # Sort candidates to prioritize those already in cache
    # This makes the scan "Local-First" and much faster
    cached_candidates = []
    others = []

    for row in symbols_data:
        if not isinstance(row, dict):
            continue
        sym = str(row.get("Code", row.get("Symbol", "")))
        ex = str(row.get("Exchange", ""))
        try:
            if check_local_cache(sym, ex):
                cached_candidates.append(row)
            else:
                others.append(row)
        except Exception:
            continue

    # Combine: Local cached first, then others
    sorted_candidates = cached_candidates + others
    candidates = sorted_candidates[:limit]

    results = []

    rf_preset = (opts.rf_preset if opts else None) or "fast"
    rf_params = (opts.rf_params if opts else None) or None
    model_name = (opts.model_name if opts else None) or None

    if not model_name:
        raise HTTPException(
            status_code=400,
            detail="model_name is required for AI scan (inference-only).",
        )

    try:
        for row in candidates:
            # Check if user disconnected to stop processing immediately
            if await request.is_disconnected():
                print("Client disconnected, stopping scan_ai.")
                break

            if not isinstance(row, dict):
                continue

            symbol = str(row.get("Code", row.get("Symbol", "")))
            name = str(row.get("Name", ""))
            exchange = str(row.get("Exchange", ""))

            # Skip if symbol is empty or NOT in local cache (Local-First enforcement)
            if not symbol or not check_local_cache(symbol, exchange):
                continue

            try:
                # Skip fundamentals for speed during scan
                prediction = run_pipeline(
                    api_key=api_key,
                    ticker=symbol,
                    from_date="2020-01-01",
                    include_fundamentals=False,
                    tolerance_days=5,  # Allow cached data up to 5 days old for scanning speed
                    exchange=exchange,
                    force_local=True,
                    rf_preset=rf_preset,
                    rf_params=rf_params,
                    model_name=model_name,
                )

                # Check for BUY signal
                if prediction["tomorrowPrediction"] == 1:
                    prec = prediction["precision"]

                    if prec >= min_precision:
                        results.append(
                            ScanResult(
                                symbol=symbol,
                                exchange=exchange or None,
                                name=name,
                                last_close=prediction["lastClose"],
                                precision=prec,
                                signal="BUY",
                                confidence="High" if prec > 0.7 else "Medium",
                                logo_url=prediction.get("fundamentals", {}).get(
                                    "logoUrl"
                                ),
                            )
                        )

            except Exception:
                continue
    except Exception as e:
        print(f"scan_ai: unexpected error: {e}")
        raise HTTPException(status_code=500, detail="Scan failed")

    # Sort by precision descending
    results.sort(key=lambda x: x.precision, reverse=True)

    return ScanResponse(results=results, scanned_count=len(candidates))


@router.post("/ai/single", response_model=Optional[ScanResult])
async def scan_ai_single(req: SingleScanRequest):
    api_key = os.getenv("EODHD_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="API Key not configured")

    if not req.symbol:
        return None

    try:
        # We enforce local-first for scanning speed
        if not check_local_cache(req.symbol, req.exchange):
            return None

        prediction = run_pipeline(
            api_key=api_key,
            ticker=req.symbol,
            from_date="2020-01-01",
            include_fundamentals=False,
            tolerance_days=5,
            exchange=req.exchange,
            force_local=True,
            rf_preset=req.rf_preset or "fast",
            rf_params=req.rf_params,
            model_name=req.model_name,
        )

        if prediction["tomorrowPrediction"] == 1:
            prec = prediction["precision"]
            if prec >= req.min_precision:
                return ScanResult(
                    symbol=req.symbol,
                    exchange=req.exchange,
                    name=req.symbol,
                    last_close=prediction["lastClose"],
                    precision=prec,
                    signal="BUY",
                    confidence="High" if prec > 0.7 else "Medium",
                    logo_url=prediction.get("fundamentals", {}).get("logoUrl"),
                )
    except Exception as e:
        print(f"Error scanning {req.symbol}: {e}")
        return None

    return None


@router.get("/similarity/published")
async def api_get_published_similarity_report():
    try:
        from api.historical_similarity import get_published_similarity_report
        return get_published_similarity_report()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stocks/{symbol}/news")
async def get_stock_news(symbol: str):
    try:
        from api.stock_ai import _init_supabase, supabase
        _init_supabase()
        if not supabase:
            raise HTTPException(status_code=500, detail="Database not initialized")
            
        sym_clean = symbol.split(".")[0].upper()
        res = (
            supabase.table("stock_news_sentiment")
            .select("sentiment_score, news_count, negative_flag, positive_flag, headlines, sources, date")
            .eq("symbol", sym_clean)
            .order("date", desc=True)
            .limit(10)
            .execute()
        )
        return res.data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/news")
async def get_all_news(
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    symbol: Optional[str] = None,
    sentiment: Optional[str] = None,
    search: Optional[str] = None,
    date: Optional[str] = None
):
    try:
        from api.stock_ai import _init_supabase, supabase
        _init_supabase()
        if not supabase:
            raise HTTPException(status_code=500, detail="Database not initialized")
            
        query = supabase.table("stock_news_sentiment").select("*", count="exact")
        
        # Hide stocks with no news (news_count = 0) unless searching
        has_search = False
        if search and search.strip():
            has_search = True
        if symbol and symbol.strip():
            has_search = True
        if date and date.strip():
            has_search = True
            
        if not has_search:
            query = query.gt("news_count", 0)
            
        if symbol:
            query = query.eq("symbol", symbol.upper())
            
        if date:
            query = query.eq("date", date)
            
        if sentiment == "positive":
            query = query.gt("sentiment_score", 0.15)
        elif sentiment == "negative":
            query = query.lt("sentiment_score", -0.15)
        elif sentiment == "neutral":
            query = query.gte("sentiment_score", -0.15).lte("sentiment_score", 0.15)
            
        if search:
            query = query.ilike("symbol", f"%{search}%")
            
        res = query.order("date", desc=True).range(offset, offset + limit - 1).execute()
        return {
            "data": res.data,
            "count": res.count
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

