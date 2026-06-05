import numpy as np
import pandas as pd
import os
import sys
import pickle
from backtest_radar import run_radar_simulation, load_model, reconstruct_meta_model
import api.stock_ai as stock_ai
from api.train_exchange_model import add_technical_indicators, add_massive_features, add_market_context, fetch_fundamentals_for_exchange
from dotenv import load_dotenv

# Load environment variables
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(base_dir, ".env"))
load_dotenv(os.path.join(base_dir, "web", ".env.local"), override=True)

def load_models_and_data(exchange="EGX", model_name="KING 👑.pkl", start_date="2024-01-01"):
    """
    Load data and models for optimization
    """
    print("🔄 Loading data and models...")
    
    # Load data
    buffer_start = "2023-01-01"
    data_map = stock_ai._get_exchange_bulk_data(exchange, from_date=buffer_start)
    if not data_map:
        raise Exception("No data found")
    
    # Load fundamentals
    df_funds = pd.DataFrame()
    if stock_ai.supabase:
        df_funds = fetch_fundamentals_for_exchange(stock_ai.supabase, exchange)
    
    # Load market context for EGX
    market_df = None
    if exchange == "EGX":
        try:
            import json
            index_path = os.path.join(base_dir, "symbols_data", "EGX30-INDEX.json")
            if os.path.exists(index_path):
                with open(index_path, "r") as f:
                    idx_data = json.load(f)
                market_df = pd.DataFrame(idx_data)
                market_df['date'] = pd.to_datetime(market_df['date'])
                market_df.set_index('date', inplace=True)
                print("DEBUG OPTIMIZE: Market context (EGX30) loaded from JSON.")
        except Exception as e:
            print(f"DEBUG OPTIMIZE: Failed to load market context from JSON: {e}")
            
        if market_df is None or market_df.empty:
            try:
                stock_ai._init_supabase()
                if stock_ai.supabase:
                    print("DEBUG OPTIMIZE: Loading EGX30 index from Supabase...")
                    offset = 0
                    limit = 1000
                    all_data = []
                    while True:
                        idx_res = (
                            stock_ai.supabase.table("stock_prices")
                            .select("date, close")
                            .eq("symbol", "EGX30")
                            .eq("exchange", "INDX")
                            .order("date", desc=False)
                            .range(offset, offset + limit - 1)
                            .execute()
                        )
                        if not idx_res.data:
                            break
                        all_data.extend(idx_res.data)
                        if len(idx_res.data) < limit:
                            break
                        offset += limit
                    
                    if all_data:
                        market_df = pd.DataFrame(all_data)
                        market_df["date"] = pd.to_datetime(market_df["date"])
                        market_df = market_df.set_index("date").sort_index()
                        print(f"DEBUG OPTIMIZE: Loaded {len(market_df)} EGX30 index rows from Supabase.")
            except Exception as db_err:
                print(f"DEBUG OPTIMIZE: Failed to load market context from Supabase: {db_err}")
    
    # Load model
    models_dir = os.path.join(base_dir, "api", "models")
    model_path = os.path.join(models_dir, model_name)
    model = load_model(model_path)
    
    # Prepare combined dataframe
    all_data = []
    for symbol, df in data_map.items():
        if df.empty or len(df) < 60:
            continue
            
        try:
            original_index = df.index
            if not isinstance(original_index, pd.DatetimeIndex):
                original_index = pd.to_datetime(original_index)
            
            df_feat = add_technical_indicators(df)
            if df_feat.empty:
                continue
            
            if len(df_feat) == len(df):
                df_feat.index = original_index
            
            df_feat = add_massive_features(df_feat)
            
            if market_df is not None:
                df_feat = add_market_context(df_feat, market_df)
            
            df_feat['symbol'] = symbol
            if not df_funds.empty:
                df_feat = df_feat.join(df_funds.set_index("symbol"), on="symbol", how="left")
            
            if len(df_feat) == len(df):
                df_feat.index = original_index
            
            df_feat = df_feat.fillna(0)
            
            # Filter to simulation period
            sim_start_dt = pd.to_datetime(start_date, dayfirst=True).tz_localize(None)
            if not isinstance(df_feat.index, pd.DatetimeIndex):
                df_feat.index = pd.to_datetime(df_feat.index, errors="coerce")
            idx_clean = pd.DatetimeIndex(df_feat.index).tz_localize(None)
            
            mask = idx_clean >= sim_start_dt
            df_sim = df_feat[mask]
            
            if not df_sim.empty:
                all_data.append(df_sim)
                
        except Exception as e:
            print(f"Error processing {symbol}: {e}")
            continue
    
    if not all_data:
        raise Exception("No valid data after processing")
    
    combined_data = pd.concat(all_data, ignore_index=False)
    
    return combined_data, model, None

def find_golden_threshold(exchange="EGX", model_name="KING 👑.pkl", start_date="2024-01-01", step=0.05):
    print(f"🧪 Starting Brute-Force Optimization for {model_name} on {exchange}...")
    print("=" * 60)
    print(f"{'Threshold':<10} | {'Trades':<8} | {'Win Rate':<10} | {'Net Profit':<15} | {'Note'}")
    print("-" * 60)

    # 1. Load data and models once
    try:
        data, model, council_model = load_models_and_data(exchange=exchange, model_name=model_name, start_date=start_date) 
    except Exception as e:
        print(f"❌ Error loading: {e}")
        return
    
    best_profit = -np.inf
    best_threshold = 0.0
    
    # 2. Optimization loop
    for threshold in np.arange(0.30, 0.90, step):
        
        # Run simulation
        stats = run_radar_simulation(
            df=data, 
            model=model, 
            council=council_model, 
            threshold=threshold
        )
        
        trades_log = stats.get('Trades Log', pd.DataFrame())
        if not trades_log.empty and 'Status' in trades_log.columns:
            accepted_trades = trades_log[trades_log['Status'] != 'Rejected']
        else:
            accepted_trades = pd.DataFrame()
        
        if not accepted_trades.empty:
            # We assume 10k capital per trade for relative comparison
            profit = accepted_trades['PnL_Pct'].sum() * 10000 
            win_rate = (accepted_trades['PnL_Pct'] > 0).mean() * 100
            trades_count = len(accepted_trades)
        else:
            profit = 0
            win_rate = 0
            trades_count = 0
        
        # 3. Evaluate
        note = ""
        if profit > best_profit and trades_count > 0:
            best_profit = profit
            best_threshold = threshold
            note = "🔥 NEW HIGH!"
        elif win_rate > 60 and profit > 0:
            note = "🛡️ SAFE ZONE"
            
        print(f"{threshold:.2f}       | {trades_count:<8} | {win_rate:.1f}%     | {profit:,.0f}           | {note}")

    print("=" * 60)
    print(f"🏆 BEST SETTING: Threshold = {best_threshold:.2f} (Estimated Profit: {best_profit:,.0f})")
    return {"best_threshold": float(best_threshold), "best_profit": float(best_profit)}

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--exchange", default="EGX")
    parser.add_argument("--model", default="KING 👑.pkl")
    parser.add_argument("--start", default="2024-01-01")
    parser.add_argument("--step", type=float, default=0.05)
    args = parser.parse_args()
    
    find_golden_threshold(
        exchange=args.exchange,
        model_name=args.model,
        start_date=args.start,
        step=args.step
    )
