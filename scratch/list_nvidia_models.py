import os
import json
import urllib.request
from dotenv import load_dotenv

load_dotenv()
load_dotenv("web/.env.local")

api_key = os.getenv("NVIDIA_API_KEY") or os.getenv("NVIDIA_SECONDARY_API_KEY")

if not api_key:
    # Try fetching from DB settings
    import sys
    sys.path.append(os.path.abspath("scratch"))
    from check_settings import get_settings
    settings = get_settings()
    if settings:
        api_key = settings[0].get("api_key")

if not api_key:
    print("No NVIDIA API key found.")
    exit(1)

req = urllib.request.Request(
    "https://integrate.api.nvidia.com/v1/models",
    headers={"Authorization": f"Bearer {api_key}"}
)

try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        models = [m["id"] for m in data.get("data", [])]
        print(f"Total models: {len(models)}")
        print("Vision/Multimodal models:")
        for m in sorted(models):
            if "vision" in m.lower() or "vlm" in m.lower() or "pixtral" in m.lower() or "llava" in m.lower() or "paligemma" in m.lower() or "neva" in m.lower() or "deplot" in m.lower() or "kosmos" in m.lower() or "fuyu" in m.lower():
                print(f" - {m}")
        print("\nAll models:")
        for m in sorted(models):
            print(f" - {m}")
except Exception as e:
    print("Error:", e)
