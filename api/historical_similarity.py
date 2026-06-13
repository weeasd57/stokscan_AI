import os
import json
import uuid
import numpy as np
import pandas as pd
from datetime import datetime
from typing import List, Dict, Any, Tuple, Optional
from api.stock_ai import get_stock_data_eodhd, add_technical_indicators

SAVED_CASES_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "historical_similarity_cases.json"
)

def _load_saved_cases() -> List[Dict[str, Any]]:
    if not os.path.exists(SAVED_CASES_FILE):
        return []
    try:
        with open(SAVED_CASES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            elif isinstance(data, dict) and "cases" in data:
                return data["cases"]
            return []
    except Exception as e:
        print(f"Error loading saved similarity cases: {e}")
        return []

def _save_saved_cases(cases: List[Dict[str, Any]]):
    try:
        with open(SAVED_CASES_FILE, "w", encoding="utf-8") as f:
            json.dump({"cases": cases}, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Error saving similarity cases: {e}")

def get_similarity_cases() -> List[Dict[str, Any]]:
    """Get all saved similarity scan profiles."""
    return _load_saved_cases()

def save_similarity_case(profile: Dict[str, Any]) -> Dict[str, Any]:
    """Save or update a similarity scan profile."""
    cases = _load_saved_cases()
    
    if not profile.get("id"):
        profile["id"] = str(uuid.uuid4())
        profile["created_at"] = datetime.now().isoformat()
        cases.append(profile)
    else:
        # Update existing
        found = False
        for i, c in enumerate(cases):
            if c.get("id") == profile["id"]:
                profile["created_at"] = c.get("created_at", datetime.now().isoformat())
                profile["updated_at"] = datetime.now().isoformat()
                cases[i] = profile
                found = True
                break
        if not found:
            profile["created_at"] = datetime.now().isoformat()
            cases.append(profile)
            
    _save_saved_cases(cases)
    return profile

def delete_similarity_case(case_id: str) -> bool:
    """Delete a saved similarity scan profile."""
    cases = _load_saved_cases()
    initial_len = len(cases)
    cases = [c for c in cases if c.get("id") != case_id]
    if len(cases) < initial_len:
        _save_saved_cases(cases)
        return True
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
    df_target = get_stock_data_eodhd(
        api=None,
        ticker=symbol,
        from_date="2010-01-01",
        exchange=sb_exchange,
        force_local=True
    )
    
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
                df_s = get_stock_data_eodhd(None, s_t, "2010-01-01", exchange=sb_exchange, force_local=True)
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
    
    # 7. Apply exclusion window
    exclude_mask = []
    target_symbol_lower = symbol.lower()
    
    for idx, row in combined_feats_clean.iterrows():
        is_same_symbol = row["symbol_source"].lower() == target_symbol_lower
        is_too_close = abs((idx - target_ts).days) <= exclusion_window
        if is_same_symbol and is_too_close:
            exclude_mask.append(False)
        else:
            exclude_mask.append(True)
            
    exclude_mask = np.array(exclude_mask)
    search_matrix_filtered = search_matrix_std[exclude_mask]
    filtered_index_df = combined_feats_clean[exclude_mask]
    
    if len(search_matrix_filtered) == 0:
        return {
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
        }
        
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
    
    # Sort and get top K
    top_matches_df = filtered_index_df.sort_values(by="similarity", ascending=False).head(k)
    
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
    expected_value = (win_rate * max(0.0, target_return)) + ((1 - win_rate) * stop_loss)
    
    return {
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
