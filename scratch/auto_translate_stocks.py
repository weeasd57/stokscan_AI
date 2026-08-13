import os
import json
import urllib.request
from dotenv import load_dotenv

load_dotenv("web/.env.local")

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY")

def fetch_null_name_ar():
    url = f"{SUPABASE_URL}/rest/v1/stock_fundamentals?select=symbol,name&name_ar=is.null"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Range": "0-1000"
    })
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"Error fetching data: {e}")
        return []

def translate_batch(stocks):
    prompt = """
    You are an expert in the Egyptian Stock Exchange (EGX).
    Translate the following English stock names to their most common Arabic names or aliases used by Egyptian traders.
    If a stock is commonly known by a short alias (e.g. 'المصرية للاتصالات' instead of 'الشركة المصرية للاتصالات'), provide that.
    Return ONLY a valid JSON object where keys are the symbols and values are the Arabic names. No markdown tags, no markdown blocks, no other text.
    """
    lines = []
    for s in stocks:
        lines.append(f"{s['symbol']}: {s['name']}")
    
    prompt += "\n\n" + "\n".join(lines)
    
    req = urllib.request.Request(
        "https://api.deepseek.com/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {DEEPSEEK_KEY}"
        },
        method="POST",
        data=json.dumps({
            "model": "deepseek-chat",
            "messages": [
                {"role": "system", "content": "You output strict raw JSON without backticks or markdown."},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.0
        }).encode("utf-8")
    )
    
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            data = json.loads(response.read().decode("utf-8"))
            content = data["choices"][0]["message"]["content"]
            # Clean up potential markdown
            content = content.replace("```json", "").replace("```", "").strip()
            return json.loads(content)
    except Exception as e:
        print(f"Error calling DeepSeek API: {e}")
        return {}

def update_db(translations):
    for symbol, name_ar in translations.items():
        if not name_ar or not symbol:
            continue
        
        name_ar_clean = str(name_ar).replace("'", "''")
        url = f"{SUPABASE_URL}/rest/v1/stock_fundamentals?symbol=eq.{symbol}"
        req = urllib.request.Request(url, headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        }, method="PATCH", data=json.dumps({"name_ar": name_ar_clean}).encode("utf-8"))
        try:
            urllib.request.urlopen(req)
        except Exception as e:
            print(f"Failed to update {symbol}: {e}")

def main():
    print("Fetching stocks with NULL name_ar...")
    stocks = fetch_null_name_ar()
    print(f"Found {len(stocks)} stocks to translate.")
    
    # Process in batches of 50
    batch_size = 50
    for i in range(0, len(stocks), batch_size):
        batch = stocks[i:i+batch_size]
        print(f"Translating batch {i//batch_size + 1}...")
        translations = translate_batch(batch)
        if translations:
            print(f"Updating {len(translations)} stocks in DB...")
            update_db(translations)
    
    print("All done!")

if __name__ == "__main__":
    main()
