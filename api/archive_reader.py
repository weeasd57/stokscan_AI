import pandas as pd
import io
import gzip
import traceback
from typing import Optional

def fetch_archived_stock_prices(supabase, symbol: str) -> Optional[pd.DataFrame]:
    """
    Fetches the archived historical stock data (CSV.gz) from Supabase Storage
    for the given symbol.
    """
    try:
        bucket_name = "old-stock-data"
        file_path = f"{symbol}.csv.gz"
        
        # Download the file from storage
        res = supabase.storage.from_(bucket_name).download(file_path)
        
        if not res:
            return None
            
        # Decompress and read into pandas DataFrame
        with gzip.GzipFile(fileobj=io.BytesIO(res)) as gz:
            df = pd.read_csv(gz)
            
        if not df.empty and 'date' in df.columns:
            df['date'] = pd.to_datetime(df['date']).dt.date
            # Sort chronologically just in case
            df = df.sort_values(by='date').reset_index(drop=True)
            return df
            
        return None
        
    except Exception as e:
        # File might not exist for this symbol, which is fine
        if "Object not found" not in str(e):
            print(f"ArchiveReader: Error fetching {symbol} from storage: {e}")
        return None

def merge_with_archive(supabase, symbol: str, db_df: pd.DataFrame) -> pd.DataFrame:
    """
    Helper to merge DB prices with archived prices if available.
    """
    archived_df = fetch_archived_stock_prices(supabase, symbol)
    if archived_df is not None and not archived_df.empty:
        if db_df.empty:
            return archived_df
            
        # Merge and remove duplicates
        combined = pd.concat([archived_df, db_df], ignore_index=True)
        combined['date'] = pd.to_datetime(combined['date'])
        combined = combined.drop_duplicates(subset=['date'], keep='last')
        combined = combined.sort_values(by='date').reset_index(drop=True)
        return combined
    return db_df
