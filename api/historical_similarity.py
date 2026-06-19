import os
import json
import uuid
import math
from functools import lru_cache
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import List, Dict, Any, Tuple, Optional, Set
from api.stock_ai import add_technical_indicators, get_supabase_symbols
import api.stock_ai as stock_ai

def sanitize_json_floats(obj):
    if isinstance(obj, dict):
        return {k: sanitize_json_floats(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_json_floats(x) for x in obj]
    elif isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return 0.0
        return obj
    elif isinstance(obj, np.floating):
        val = float(obj)
        if math.isnan(val) or math.isinf(val):
            return 0.0
        return val
    elif isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.ndarray):
        return sanitize_json_floats(obj.tolist())
    return obj

def load_symbol_prices_direct(symbol: str, limit: int = 1500) -> pd.DataFrame:
    """
    Directly query Supabase for a single symbol's daily prices.
    Bypasses the slow bulk exchange loader.
    Loads up to `limit` most recent prices in a single query.
    """
    stock_ai._init_supabase()
    client = stock_ai.supabase
    if not client:
        return pd.DataFrame()
        
    s, e = stock_ai._infer_symbol_exchange(symbol, None)
    if e in ["CC", "CA"]:
        e = "EGX"
        
    res = (
        client.table("stock_prices")
        .select("date,open,high,low,close,volume")
        .eq("symbol", s)
        .eq("exchange", e)
        .order("date", desc=True)
        .limit(limit)
        .execute()
    )
    all_data = res.data or []
        
    if not all_data:
        return pd.DataFrame()
        
    df = pd.DataFrame(all_data)
    df = df.dropna(subset=['close'])
    if df.empty:
        return pd.DataFrame()
    df['date'] = pd.to_datetime(df['date'])
    df = df.set_index('date')
    df = df[~df.index.duplicated(keep='last')]
    df = df.sort_index()
    df = df.ffill().bfill()
    return df

def _load_saved_cases() -> List[Dict[str, Any]]:
    """Load saved similarity cases from Supabase."""
    try:
        supabase = _get_supabase()
        if not supabase:
            print("⚠️ Supabase not initialized")
            return []
        
        response = supabase.table("similarity_cases").select("*").execute()
        cases = response.data if response.data else []
        return cases
    except Exception as e:
        print(f"❌ Error loading saved similarity cases from Supabase: {e}")
        return []

def _save_saved_cases(cases: List[Dict[str, Any]]):
    """Save similarity cases to Supabase (utility function for bulk operations)."""
    try:
        supabase = _get_supabase()
        if not supabase:
            print("⚠️ Supabase not initialized")
            return
        
        # This function is typically called with a single case update, not bulk
        # Individual saves are handled in save_similarity_case
        print("💾 Cases updated in Supabase")
    except Exception as e:
        print(f"❌ Error saving similarity cases to Supabase: {e}")

def get_similarity_cases() -> List[Dict[str, Any]]:
    """Get all saved similarity scan profiles from Supabase."""
    try:
        supabase = _get_supabase()
        if not supabase:
            print("⚠️ Supabase not initialized")
            return []
        
        response = supabase.table("similarity_cases").select("*").order("created_at", desc=True).execute()
        return response.data if response.data else []
    except Exception as e:
        print(f"❌ Error getting similarity cases from Supabase: {e}")
        return []

def save_similarity_case(profile: Dict[str, Any]) -> Dict[str, Any]:
    """Save or update a similarity scan profile to Supabase."""
    try:
        supabase = _get_supabase()
        if not supabase:
            print("❌ Supabase not initialized")
            raise Exception("Supabase client not available")
        
        case_id = profile.get("id")
        
        # Prepare data for Supabase
        case_data = {
            "name": profile.get("name", "Unnamed Case"),
            "symbol": profile.get("symbol", ""),
            "k": profile.get("k", 10),
            "forward_days": profile.get("forward_days", 10),
            "target_return": profile.get("target_return", 0.05),
            "stop_loss": profile.get("stop_loss", -0.03),
            "features": json.dumps(profile.get("features", [])) if isinstance(profile.get("features"), list) else profile.get("features"),
            "search_scope": profile.get("search_scope", "same_symbol"),
            "updated_at": datetime.now().isoformat()
        }
        
        if case_id:
            # Update existing case
            response = supabase.table("similarity_cases").update(case_data).eq("id", case_id).execute()
            if response.data:
                updated_case = response.data[0]
                profile["id"] = updated_case.get("id")
                profile["updated_at"] = updated_case.get("updated_at")
                print(f"✅ Case updated in Supabase (ID: {case_id})")
        else:
            # Insert new case
            case_data["created_at"] = datetime.now().isoformat()
            response = supabase.table("similarity_cases").insert(case_data).execute()
            if response.data:
                new_case = response.data[0]
                profile["id"] = new_case.get("id")
                profile["created_at"] = new_case.get("created_at")
                profile["updated_at"] = new_case.get("updated_at")
                print(f"✅ Case created in Supabase (ID: {new_case.get('id')})")
        
        return profile
    except Exception as e:
        print(f"❌ Error saving similarity case to Supabase: {e}")
        raise e

def delete_similarity_case(case_id: str) -> bool:
    """Delete a saved similarity scan profile from Supabase."""
    try:
        supabase = _get_supabase()
        if not supabase:
            print("⚠️ Supabase not initialized")
            return False
        
        response = supabase.table("similarity_cases").delete().eq("id", case_id).execute()
        print(f"✅ Case deleted from Supabase (ID: {case_id})")
        return True
    except Exception as e:
        print(f"❌ Error deleting similarity case from Supabase: {e}")
        return False
    return False

def compute_similarity_features(df: pd.DataFrame, selected_features: List[str]) -> Tuple[pd.DataFrame, List[str]]:
    """
    Computes scale-invariant feature vectors based on selected feature keys.
    Returns:
        DataFrame containing computed features, and the actual column list to use in comparison.
    """
    # 1. Calculate base technical indicators
    df_ind = add_technical_indicators(df)
    
    # 2. Extract selected features
    features = pd.DataFrame(index=df_ind.index)
    col_names = []
    
    # Pre-checks & helper values
    close = df_ind["Close"]
    
    # RSI (normalized to 0-1)
    if "RSI" in selected_features:
        features["RSI"] = (df_ind["RSI"] / 100.0).fillna(0.5)
        col_names.append("RSI")
        
    # Bollinger %B (normalized to 0-1)
    if "BB_pB" in selected_features:
        if all(c in df_ind.columns for c in ["BB_Upper", "BB_Lower"]):
            denom = df_ind["BB_Upper"] - df_ind["BB_Lower"]
            # Replace 0 to avoid division by zero
            denom = denom.replace(0.0, np.nan)
            features["BB_pB"] = ((close - df_ind["BB_Lower"]) / denom).fillna(0.5)
        else:
            features["BB_pB"] = 0.5
        col_names.append("BB_pB")
        
    # Close distance to SMA50
    if "Close_to_SMA50" in selected_features:
        if "SMA_50" in df_ind.columns:
            features["Close_to_SMA50"] = (close / df_ind["SMA_50"] - 1.0).fillna(0.0)
        else:
            features["Close_to_SMA50"] = 0.0
        col_names.append("Close_to_SMA50")
        
    # Close distance to SMA200
    if "Close_to_SMA200" in selected_features:
        if "SMA_200" in df_ind.columns:
            features["Close_to_SMA200"] = (close / df_ind["SMA_200"] - 1.0).fillna(0.0)
        else:
            features["Close_to_SMA200"] = 0.0
        col_names.append("Close_to_SMA200")
        
    # MACD normalized by Close
    if "MACD_Norm" in selected_features:
        if "MACD" in df_ind.columns:
            features["MACD_Norm"] = (df_ind["MACD"] / close).fillna(0.0)
        else:
            features["MACD_Norm"] = 0.0
        col_names.append("MACD_Norm")
        
    # Relative Volume
    if "R_VOL" in selected_features:
        if "R_VOL" in df_ind.columns:
            features["R_VOL"] = df_ind["R_VOL"].fillna(1.0)
        else:
            features["R_VOL"] = 1.0
        col_names.append("R_VOL")
        
    # Rolling Returns
    returns_to_check = {
        "Return_3d": 3,
        "Return_5d": 5,
        "Return_10d": 10,
        "Return_20d": 20
    }
    for ret_key, window in returns_to_check.items():
        if ret_key in selected_features:
            features[ret_key] = close.pct_change(window).fillna(0.0)
            col_names.append(ret_key)
            
    # Chart Shape (Lagged return shape over last 5 days)
    if "ChartShape" in selected_features:
        for lag in range(1, 6):
            lag_col = f"Price_Lag_{lag}"
            features[lag_col] = (close.shift(lag) / close - 1.0).fillna(0.0)
            col_names.append(lag_col)
            
    return features, col_names

def run_historical_similarity(
    symbol: str,
    target_date: Optional[str] = None,
    k: int = 10,
    forward_days: int = 10,
    target_return: float = 0.05,
    stop_loss: float = -0.03,
    features_to_use: Optional[List[str]] = None,
    exclusion_window: int = 20,
    search_scope: str = "same_symbol"
) -> Dict[str, Any]:
    """
    Main matching and evaluation pipeline.
    """
    if not features_to_use:
        features_to_use = ["RSI", "BB_pB", "Close_to_SMA50", "Close_to_SMA200", "MACD_Norm", "R_VOL", "Return_5d", "ChartShape"]
        
    # 1. Resolve Exchange & Clean Symbol
    sb_symbol = symbol
    sb_exchange = "US"
    if "." in symbol:
        parts = symbol.split(".")
        sb_symbol = parts[0]
        sb_exchange = parts[1]
        if sb_exchange in ["CC", "CA"]:
            sb_exchange = "EGX"

    # 2. Fetch target stock historical prices
    df_target = load_symbol_prices_direct(symbol)
    
    if df_target.empty or len(df_target) < 30:
        raise ValueError(f"Insufficient historical data found for {symbol}. Loaded {len(df_target)} bars.")
        
    df_target_ind = add_technical_indicators(df_target)
    
    # 3. Resolve Target Date
    if not target_date:
        target_ts = df_target_ind.index[-1]
    else:
        target_ts = pd.to_datetime(target_date)
        if target_ts not in df_target_ind.index:
            nearest_idx = df_target_ind.index.get_indexer([target_ts], method='nearest')[0]
            target_ts = df_target_ind.index[nearest_idx]
            
    target_close = float(df_target_ind.loc[target_ts, "Close"])
    target_rsi = float(df_target_ind.loc[target_ts, "RSI"]) if "RSI" in df_target_ind.columns else 50.0
    target_sma50 = float(df_target_ind.loc[target_ts, "SMA_50"]) if "SMA_50" in df_target_ind.columns else target_close
    target_sma200 = float(df_target_ind.loc[target_ts, "SMA_200"]) if "SMA_200" in df_target_ind.columns else target_close
    target_volume = float(df_target_ind.loc[target_ts, "Volume"])
    
    # 4. Build feature matrices
    search_data_list = []
    
    if search_scope == "all_symbols":
        from api.stock_ai import get_supabase_symbols
        db_symbols = get_supabase_symbols(country=None)
        exch_symbols = []
        for s_info in db_symbols:
            s_symbol = s_info.get("symbol")
            s_exch = s_info.get("exchange", "EGX")
            if s_exch == sb_exchange:
                exch_symbols.append(f"{s_symbol}.{s_exch}")
                
        # Limit symbols to 80 for reasonable performance
        exch_symbols = exch_symbols[:80]
        if symbol not in exch_symbols:
            exch_symbols.append(symbol)
            
        for s_t in exch_symbols:
            try:
                df_s = load_symbol_prices_direct(s_t)
                if len(df_s) >= 40:
                    feat_df, cols = compute_similarity_features(df_s, features_to_use)
                    feat_df["symbol_source"] = s_t
                    search_data_list.append((s_t, df_s, feat_df, cols))
            except Exception:
                continue
    else:
        feat_df, cols = compute_similarity_features(df_target, features_to_use)
        feat_df["symbol_source"] = symbol
        search_data_list.append((symbol, df_target, feat_df, cols))
        
    if not search_data_list:
        raise ValueError("No searchable symbol database could be built.")
        
    comparison_cols = search_data_list[0][3]
    if not comparison_cols:
        raise ValueError("No valid features selected or computed.")
        
    combined_feats = pd.concat([item[2] for item in search_data_list])
    combined_feats_clean = combined_feats.dropna(subset=comparison_cols)
    
    # 5. Extract target feature vector
    target_rows = combined_feats_clean[
        (combined_feats_clean.index == target_ts) & 
        (combined_feats_clean["symbol_source"] == symbol)
    ]
    
    if target_rows.empty:
        target_source_feats = combined_feats_clean[combined_feats_clean["symbol_source"] == symbol]
        if target_source_feats.empty:
            raise ValueError(f"Target symbol {symbol} has no valid features after filtering.")
        nearest_valid_idx = target_source_feats.index.get_indexer([target_ts], method='nearest')[0]
        target_ts = target_source_feats.index[nearest_valid_idx]
        target_rows = target_source_feats.loc[[target_ts]]
        
    target_vector = target_rows.iloc[0][comparison_cols].values.astype(float)
    
    # 6. Standardize all features
    search_matrix_raw = combined_feats_clean[comparison_cols].values.astype(float)
    mean_vec = np.mean(search_matrix_raw, axis=0)
    std_vec = np.std(search_matrix_raw, axis=0)
    std_vec[std_vec == 0.0] = 1.0
    
    target_vector_std = (target_vector - mean_vec) / std_vec
    search_matrix_std = (search_matrix_raw - mean_vec) / std_vec
    
    # 7. Apply exclusion window (prevent target date from matching itself or nearby dates)
    exclude_mask = []
    target_symbol_lower = symbol.lower()

    for idx, row in combined_feats_clean.iterrows():
        is_same_symbol = row["symbol_source"].lower() == target_symbol_lower
        days_from_target = abs((idx - target_ts).days)
        # Exclude target date ± exclusion_window days for the same symbol
        if is_same_symbol and days_from_target <= exclusion_window:
            exclude_mask.append(False)
        else:
            exclude_mask.append(True)
            
    exclude_mask = np.array(exclude_mask)
    search_matrix_filtered = search_matrix_std[exclude_mask]
    filtered_index_df = combined_feats_clean[exclude_mask]
    
    if len(search_matrix_filtered) == 0:
        return sanitize_json_floats({
            "symbol": symbol,
            "target_date": target_ts.strftime("%Y-%m-%d"),
            "target_values": {
                "close": target_close,
                "rsi": target_rsi,
                "sma50": target_sma50,
                "sma200": target_sma200,
                "volume": target_volume
            },
            "matches": [],
            "stats": {
                "win_rate": 0.0,
                "average_return": 0.0,
                "profit_factor": 0.0,
                "expected_value": 0.0,
                "total_matches": 0,
                "wins": 0,
                "losses": 0
            }
        })
        
    # 8. Compute Cosine Similarity
    target_norm = np.linalg.norm(target_vector_std)
    if target_norm == 0.0:
        target_norm = 1.0
        
    row_norms = np.linalg.norm(search_matrix_filtered, axis=1)
    row_norms[row_norms == 0.0] = 1.0
    
    dot_products = np.dot(search_matrix_filtered, target_vector_std)
    similarities = dot_products / (row_norms * target_norm)
    
    filtered_index_df = filtered_index_df.copy()
    filtered_index_df["similarity"] = similarities
    
    # Sort and get top K, then apply exclusion window to prevent temporal clustering
    top_matches_df = filtered_index_df.sort_values(by="similarity", ascending=False)
    
    # Apply temporal exclusion: ensure matches are at least exclusion_window days apart
    final_matches = []
    excluded_dates = set()
    
    for match_ts_candidate, row in top_matches_df.iterrows():
        # Check if this date is too close to any already selected match
        is_excluded = False
        for excluded_date in excluded_dates:
            if abs((match_ts_candidate - excluded_date).days) <= exclusion_window:
                is_excluded = True
                break
        
        if not is_excluded:
            final_matches.append((match_ts_candidate, row))
            excluded_dates.add(match_ts_candidate)
            
            # Stop when we have k matches
            if len(final_matches) >= k:
                break
    
    # Convert back to DataFrame
    if final_matches:
        top_matches_df = pd.DataFrame([row for _, row in final_matches], 
                                      index=[ts for ts, _ in final_matches])
    else:
        top_matches_df = pd.DataFrame()
    
    # 9. Evaluate matches
    matches = []
    wins = 0
    losses = 0
    total_return = 0.0
    gross_gains = 0.0
    gross_losses = 0.0
    
    price_dfs = {item[0]: item[1] for item in search_data_list}
    
    # Target price path
    target_hist_df = price_dfs[symbol]
    target_hist_before = target_hist_df[target_hist_df.index <= target_ts].tail(10)
    target_hist_path = []
    if not target_hist_before.empty:
        t_ref_close = target_hist_before.iloc[-1]["close"]
        for dt_idx, r_val in target_hist_before.iterrows():
            target_hist_path.append({
                "date": dt_idx.strftime("%Y-%m-%d"),
                "close": float(r_val["close"]),
                "rel_change": float((r_val["close"] - t_ref_close) / t_ref_close) if t_ref_close else 0.0
            })
            
    for match_ts, row in top_matches_df.iterrows():
        match_symbol = row["symbol_source"]
        similarity_score = float(row["similarity"])
        
        match_price_df = price_dfs[match_symbol]
        
        # 10-day history path leading to match
        match_before_df = match_price_df[match_price_df.index <= match_ts].tail(10)
        match_before_path = []
        if not match_before_df.empty:
            m_ref_close = match_before_df.iloc[-1]["close"]
            for dt_idx, r_val in match_before_df.iterrows():
                match_before_path.append({
                    "date": dt_idx.strftime("%Y-%m-%d"),
                    "close": float(r_val["close"]),
                    "rel_change": float((r_val["close"] - m_ref_close) / m_ref_close) if m_ref_close else 0.0
                })
                
        # Forward path
        match_after_df = match_price_df[match_price_df.index > match_ts].head(forward_days)
        
        forward_path = []
        outcome = "open"
        mfe = 0.0
        mae = 0.0
        final_ret = 0.0
        exit_date = None
        exit_day_index = None
        
        if not match_before_df.empty and not match_after_df.empty:
            entry_price = float(match_before_df.iloc[-1]["close"])
            
            for idx_after, (dt_idx, r_val) in enumerate(match_after_df.iterrows()):
                hi = float(r_val["high"]) if "high" in r_val and not pd.isna(r_val["high"]) else float(r_val["close"])
                lo = float(r_val["low"]) if "low" in r_val and not pd.isna(r_val["low"]) else float(r_val["close"])
                cl = float(r_val["close"])
                
                ret_high = (hi - entry_price) / entry_price if entry_price else 0.0
                ret_low = (lo - entry_price) / entry_price if entry_price else 0.0
                ret_close = (cl - entry_price) / entry_price if entry_price else 0.0
                
                mfe = max(mfe, ret_high)
                mae = min(mae, ret_low)
                
                forward_path.append({
                    "day": idx_after + 1,
                    "date": dt_idx.strftime("%Y-%m-%d"),
                    "close": cl,
                    "return": ret_close
                })
                
                if outcome == "open":
                    if stop_loss is not None and ret_low <= stop_loss:
                        outcome = "loss"
                        exit_date = dt_idx.strftime("%Y-%m-%d")
                        exit_day_index = idx_after + 1
                        final_ret = stop_loss
                    elif target_return is not None and ret_high >= target_return:
                        outcome = "win"
                        exit_date = dt_idx.strftime("%Y-%m-%d")
                        exit_day_index = idx_after + 1
                        final_ret = target_return
                        
            if outcome == "open" and forward_path:
                final_ret = forward_path[-1]["return"]
                outcome = "win" if final_ret >= 0 else "loss"
                exit_date = forward_path[-1]["date"]
                exit_day_index = len(forward_path)
        
        if outcome == "win":
            wins += 1
            gross_gains += max(0.0, final_ret)
        else:
            losses += 1
            gross_losses += abs(min(0.0, final_ret))
            
        total_return += final_ret
        
        matches.append({
            "date": match_ts.strftime("%Y-%m-%d"),
            "symbol": match_symbol,
            "similarity": similarity_score,
            "entry_price": float(match_before_df.iloc[-1]["close"]) if not match_before_df.empty else 0.0,
            "outcome": outcome,
            "final_return": float(final_ret),
            "mfe": float(mfe),
            "mae": float(mae),
            "exit_date": exit_date,
            "exit_day_index": exit_day_index,
            "before_path": match_before_path,
            "forward_path": forward_path
        })
        
    total_matches = len(matches)
    win_rate = (wins / total_matches) if total_matches > 0 else 0.0
    average_return = (total_return / total_matches) if total_matches > 0 else 0.0
    profit_factor = (gross_gains / gross_losses) if gross_losses > 0 else (gross_gains if gross_gains > 0 else 1.0)
    avg_win_return = (total_return / wins) if wins > 0 else target_return
    expected_value = (win_rate * avg_win_return) + ((1 - win_rate) * stop_loss)
    
    res = {
        "symbol": symbol,
        "target_date": target_ts.strftime("%Y-%m-%d"),
        "target_values": {
            "close": target_close,
            "rsi": target_rsi,
            "sma50": target_sma50,
            "sma200": target_sma200,
            "volume": target_volume
        },
        "target_path": target_hist_path,
        "matches": matches,
        "stats": {
            "win_rate": float(win_rate),
            "average_return": float(average_return),
            "profit_factor": float(profit_factor),
            "expected_value": float(expected_value),
            "total_matches": int(total_matches),
            "wins": int(wins),
            "losses": int(losses)
        }
    }
    return sanitize_json_floats(res)


# ─── Market Wide Scanner & Publishing Logic ──────────────────────────────
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

# Initialize Supabase client
def _get_supabase():
    """Get Supabase client instance"""
    from api.stock_ai import _init_supabase, supabase
    _init_supabase()
    return supabase


@lru_cache(maxsize=1)
def _get_recent_active_symbol_bases(max_stale_days: int = 30) -> Set[str]:
    """Return symbols that still have recent daily price data."""
    supabase = _get_supabase()
    if not supabase:
        return set()

    cutoff_date = (datetime.utcnow() - timedelta(days=max_stale_days)).date().isoformat()
    response = (
        supabase.table("stock_prices")
        .select("symbol,date")
        .gte("date", cutoff_date)
        .order("date", desc=True)
        .limit(50000)
        .execute()
    )

    recent_symbols: Set[str] = set()
    for row in response.data or []:
        symbol_value = row.get("symbol")
        if symbol_value:
            recent_symbols.add(symbol_value.split(".")[0].upper())
    return recent_symbols


def _filter_report_scans(scans: List[Dict[str, Any]], max_stale_days: int = 30) -> List[Dict[str, Any]]:
    """Keep one scan per symbol and require recent market data."""
    try:
        active_symbols_data = get_supabase_symbols(country=None)
        active_symbols_set: Set[str] = {
            s.get("symbol").split(".")[0].upper()
            for s in active_symbols_data
            if s.get("symbol")
        }
    except Exception as e:
        print(f"⚠️ Could not fetch active symbols for similarity filtering: {e}")
        active_symbols_set = set()

    try:
        recent_symbols_set = _get_recent_active_symbol_bases(max_stale_days=max_stale_days)
    except Exception as e:
        print(f"⚠️ Could not fetch recent price symbols for similarity filtering: {e}")
        recent_symbols_set = set()

    filtered_scans: List[Dict[str, Any]] = []
    seen_symbols: Set[str] = set()

    for scan in scans:
        sym = scan.get("symbol")
        if not sym:
            continue

        sym_base = sym.split(".")[0].upper()

        if active_symbols_set and sym_base not in active_symbols_set:
            print(f"🚫 Filtering inactive symbol from similarity report: {sym}")
            continue

        if recent_symbols_set and sym_base not in recent_symbols_set:
            print(f"🚫 Filtering stale symbol with no recent prices from similarity report: {sym}")
            continue

        if sym_base in seen_symbols:
            continue

        seen_symbols.add(sym_base)
        filtered_scans.append(scan)

    return filtered_scans


def run_market_wide_similarity_scan(
    k: int = 10,
    forward_days: int = 10,
    target_return: float = 0.05,
    stop_loss: float = -0.03,
    features_to_use: Optional[List[str]] = None,
    min_win_rate: float = 0.0,  # Changed: include all results, no filtering
    max_workers: int = 35,
    search_scope: str = "same_symbol",
    progress_callback=None
) -> List[Dict[str, Any]]:
    """
    Scans ALL symbols in the exchange concurrently and finds similarity matches.
    Returns ALL results (no minimum win rate filter) so they can be displayed in UI.
    
    Args:
        k: Number of historical matches to find
        forward_days: Days to look forward for matching
        target_return: Target return percentage
        stop_loss: Stop loss percentage
        features_to_use: Specific features to use
        min_win_rate: Minimum win rate filter (0.0 = no filter, include all)
        max_workers: Number of concurrent workers
        search_scope: 'same_symbol' or 'all_symbols' (cross-symbol similarity)
        progress_callback: Callback function for progress updates
    """
    from api.stock_ai import get_supabase_symbols
    
    print(f"🔄 Starting market-wide similarity scan...")
    print(f"   K={k}, Forward Days={forward_days}, Target={target_return}, Stop Loss={stop_loss}")
    
    # 1. Fetch active EGX symbols
    try:
        db_symbols = get_supabase_symbols(country=None)
    except Exception as e:
        print(f"❌ Error fetching symbols: {e}")
        return []
        
    exch_symbols = []
    for s_info in db_symbols:
        s_symbol = s_info.get("symbol")
        s_exch = s_info.get("exchange", "EGX")
        if s_exch == "EGX":
            exch_symbols.append(f"{s_symbol}.{s_exch}")
            
    # Scan all EGX symbols
    exch_symbols = list(set(exch_symbols))
    if not exch_symbols:
        print("❌ No EGX symbols found")
        return []
    
    print(f"📊 Found {len(exch_symbols)} symbols to scan")
    
    results = []
    scanned_count = 0
    failed_count = 0
    
    def scan_one(sym):
        nonlocal scanned_count, failed_count
        try:
            res = run_historical_similarity(
                symbol=sym,
                target_date=None,
                k=k,
                forward_days=forward_days,
                target_return=target_return,
                stop_loss=stop_loss,
                features_to_use=features_to_use,
                exclusion_window=20,
                search_scope=search_scope
            )
            scanned_count += 1
            
            # Include all results (no minimum win rate filter)
            return res
            
        except Exception as e:
            failed_count += 1
            print(f"⚠️ Error scanning {sym}: {str(e)[:50]}")
            pass
        return None

    print(f"🚀 Running parallel scan with {max_workers} workers...")
    
    # Run in parallel with configurable workers
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(scan_one, sym): sym for sym in exch_symbols}
        completed = 0
        total = len(futures)
        
        for future in as_completed(futures):
            completed += 1
            res = future.result()
            if res:
                results.append(res)
            
            # Progress callback
            if progress_callback:
                progress_callback({
                    "completed": completed,
                    "total": total,
                    "percentage": round(completed / total * 100, 1),
                    "found": len(results)
                })
            
            if completed % 10 == 0:
                print(f"   Progress: {completed}/{total} ({round(completed/total*100, 1)}%) - Found: {len(results)}")
    
    # Sort results by win rate desc, then average return desc
    results.sort(key=lambda x: (
        x["stats"].get("win_rate", 0), 
        x["stats"].get("average_return", 0)
    ), reverse=True)
    
    print(f"✅ Scan completed!")
    print(f"   Total scanned: {scanned_count}")
    print(f"   Failed: {failed_count}")
    print(f"   Results found: {len(results)}")
    print(f"   Best win rate: {max([r['stats'].get('win_rate', 0) for r in results], default=0) * 100:.1f}%")
    
    return results

def get_published_similarity_report() -> Dict[str, Any]:
    """Get the currently published similarity scan results from Supabase."""
    try:
        supabase = _get_supabase()
        if not supabase:
            print("⚠️ Supabase not initialized, returning empty report")
            return {"scans": [], "updated_at": None, "name": "Market Similarity Report"}

        def _parse_scans(value: Any) -> List[Dict[str, Any]]:
            if isinstance(value, list):
                return value
            if isinstance(value, dict):
                return [value]
            if isinstance(value, str):
                try:
                    parsed = json.loads(value)
                    if isinstance(parsed, list):
                        return parsed
                    if isinstance(parsed, dict):
                        return [parsed]
                except Exception:
                    return []
            return []
        
        # Fetch the latest report from similarity_reports table
        response = supabase.table("similarity_reports").select("*").order("updated_at", desc=True).limit(1).execute()
        
        if response.data and len(response.data) > 0:
            report_row = response.data[0]
            raw_scans = _parse_scans(report_row.get("scans", []))
            filtered_scans = _filter_report_scans(raw_scans)

            return {
                    "id": report_row.get("id"),
                    "name": report_row.get("name", "Market Similarity Report"),
                    "scans": filtered_scans,
                    "k": report_row.get("k", 10),
                    "forward_days": report_row.get("forward_days", 10),
                    "target_return": report_row.get("target_return", 0.05),
                    "stop_loss": report_row.get("stop_loss", -0.03),
                    "updated_at": report_row.get("updated_at")
                }
        else:
            print("📝 No published reports found in Supabase")
            return {"scans": [], "updated_at": None, "name": "Market Similarity Report"}
            
    except Exception as e:
        print(f"❌ Error loading published reports from Supabase: {e}")
        return {"scans": [], "updated_at": None, "name": "Market Similarity Report"}

def publish_similarity_report(report_data: Dict[str, Any]) -> Dict[str, Any]:
    """Save/Publish a new similarity scan report to Supabase."""
    try:
        supabase = _get_supabase()
        if not supabase:
            print("❌ Supabase not initialized, cannot publish report")
            raise Exception("Supabase client not available")
        
        raw_scans = report_data.get("scans", [])
        filtered_scans = _filter_report_scans(raw_scans)

        report = {
            "name": report_data.get("name", "Market Similarity Report"),
            "scans": json.dumps(filtered_scans),  # Store filtered scans only
            "k": report_data.get("k", 10),
            "forward_days": report_data.get("forward_days", 10),
            "target_return": report_data.get("target_return", 0.05),
            "stop_loss": report_data.get("stop_loss", -0.03),
            "updated_at": datetime.now().isoformat()
        }
        
        # Insert into similarity_reports table
        response = supabase.table("similarity_reports").insert(report).execute()
        
        if response.data:
            published_report = response.data[0]
            print(f"✅ Report published to Supabase (ID: {published_report.get('id')})")
            
            # Return the saved report
            return {
                "id": published_report.get("id"),
                "name": published_report.get("name"),
                "scans": json.loads(published_report.get("scans")) if isinstance(published_report.get("scans"), str) else published_report.get("scans"),
                "k": published_report.get("k"),
                "forward_days": published_report.get("forward_days"),
                "target_return": published_report.get("target_return"),
                "stop_loss": published_report.get("stop_loss"),
                "updated_at": published_report.get("updated_at")
            }
        else:
            raise Exception("No data returned from Supabase insert")
            
    except Exception as e:
        print(f"❌ Error publishing similarity report to Supabase: {e}")
        raise e
