import os
import json
import pandas as pd
from typing import List, Dict, Any, Optional

LOCAL_CRYPTO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "local_data", "crypto")

def ensure_crypto_dir():
    os.makedirs(LOCAL_CRYPTO_DIR, exist_ok=True)

def encode_symbol(symbol: str) -> str:
    return symbol.replace("/", "---")

def decode_symbol(encoded: str) -> str:
    return encoded.replace("---", "/")

def get_crypto_file_path(symbol: str, timeframe: str) -> str:
    safe_symbol = encode_symbol(symbol)
    return os.path.join(LOCAL_CRYPTO_DIR, f"{safe_symbol}_{timeframe}.json")

def save_crypto_bars_local(symbol: str, timeframe: str, bars: List[Dict[str, Any]]):
    ensure_crypto_dir()
    filepath = get_crypto_file_path(symbol, timeframe)
    
    # Read existing bars if any to merge and deduplicate
    existing = load_crypto_bars_local(symbol, timeframe)
    
    # Merge and deduplicate by 'ts'
    merged = {b['ts']: b for b in existing}
    for b in bars:
        ts = b.get('ts')
        if not ts:
            continue
        # Standardize timestamp to string if it is datetime
        ts_str = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
        merged[ts_str] = {
            "ts": ts_str,
            "open": float(b.get("open", 0)),
            "high": float(b.get("high", 0)),
            "low": float(b.get("low", 0)),
            "close": float(b.get("close", 0)),
            "volume": float(b.get("volume", 0))
        }
        
    # Sort by 'ts' chronological
    sorted_bars = sorted(merged.values(), key=lambda x: x['ts'])
    
    # Write back to file
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(sorted_bars, f, indent=2)

def load_crypto_bars_local(symbol: str, timeframe: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    filepath = get_crypto_file_path(symbol, timeframe)
    if not os.path.exists(filepath):
        return []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
            if limit:
                return data[-limit:]
            return data
    except Exception as e:
        print(f"Error loading local crypto bars for {symbol} ({timeframe}): {e}")
        return []

def delete_crypto_bars_local(symbol: str, timeframe: str) -> bool:
    filepath = get_crypto_file_path(symbol, timeframe)
    if os.path.exists(filepath):
        try:
            os.remove(filepath)
            return True
        except Exception as e:
            print(f"Error deleting local crypto bars for {symbol} ({timeframe}): {e}")
            return False
    return False

def is_crypto_symbol(symbol: str) -> bool:
    s = (symbol or "").strip().upper()
    return "/" in s or s.endswith("USD") or s.endswith("USDT") or s.endswith("USDC")

def get_last_close_local(symbol: str) -> Optional[float]:
    # Check common timeframes in order of granularity
    for timeframe in ["1h", "15m", "5m", "1m"]:
        filepath = get_crypto_file_path(symbol, timeframe)
        if os.path.exists(filepath):
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    bars = json.load(f)
                if bars:
                    # Return last close price
                    return float(bars[-1].get("close", 0))
            except Exception:
                pass
    return None

def get_local_crypto_symbols_count() -> int:
    ensure_crypto_dir()
    if not os.path.exists(LOCAL_CRYPTO_DIR):
        return 0
    symbols = set()
    for filename in os.listdir(LOCAL_CRYPTO_DIR):
        if filename.endswith(".json"):
            # BTC---USD_1h.json -> BTC---USD
            # Split from right side on '_'
            parts = filename.rsplit("_", 1)
            if len(parts) == 2:
                symbols.add(parts[0])
    return len(symbols)

def get_crypto_symbols_stats_local(timeframe: str = "1h") -> List[Dict[str, Any]]:
    ensure_crypto_dir()
    stats = []
    if not os.path.exists(LOCAL_CRYPTO_DIR):
        return stats
        
    for filename in os.listdir(LOCAL_CRYPTO_DIR):
        suffix = f"_{timeframe}.json"
        if filename.endswith(suffix):
            encoded_symbol = filename[:-len(suffix)]
            symbol = decode_symbol(encoded_symbol)
            
            filepath = os.path.join(LOCAL_CRYPTO_DIR, filename)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    bars = json.load(f)
                if bars:
                    stats.append({
                        "symbol": symbol,
                        "rows_count": len(bars),
                        "first_ts": bars[0]["ts"],
                        "last_ts": bars[-1]["ts"]
                    })
                else:
                    stats.append({
                        "symbol": symbol,
                        "rows_count": 0,
                        "first_ts": None,
                        "last_ts": None
                    })
            except Exception as e:
                print(f"Error reading stats for {filename}: {e}")
                
    return stats

def load_all_crypto_bars_local_as_df(timeframe: str) -> pd.DataFrame:
    ensure_crypto_dir()
    all_bars = []
    if not os.path.exists(LOCAL_CRYPTO_DIR):
        return pd.DataFrame()
        
    for filename in os.listdir(LOCAL_CRYPTO_DIR):
        suffix = f"_{timeframe}.json"
        if filename.endswith(suffix):
            encoded_symbol = filename[:-len(suffix)]
            symbol = decode_symbol(encoded_symbol)
            
            filepath = os.path.join(LOCAL_CRYPTO_DIR, filename)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    bars = json.load(f)
                for b in bars:
                    all_bars.append({
                        "symbol": symbol,
                        "exchange": "CRYPTO",
                        "timeframe": timeframe,
                        "ts": b["ts"],
                        "open": b["open"],
                        "high": b["high"],
                        "low": b["low"],
                        "close": b["close"],
                        "volume": b["volume"]
                    })
            except Exception as e:
                print(f"Error reading file {filename} for bulk load: {e}")
                
    if not all_bars:
        return pd.DataFrame()
    return pd.DataFrame(all_bars)
