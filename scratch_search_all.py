import os

for root, dirs, files in os.walk("."):
    if any(p in root for p in ["venv", ".git", ".cache", "__pycache__"]):
        continue
    for file in files:
        if file.endswith((".py", ".ts", ".tsx", ".js", ".jsx", ".json")):
            filepath = os.path.join(root, file)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
                    if "market_status_Egypt" in content:
                        print(f"Found in {filepath}")
            except Exception as e:
                pass
