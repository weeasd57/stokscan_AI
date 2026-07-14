import os
import sys

sys.path.append(os.path.abspath('.'))

from dotenv import load_dotenv
load_dotenv()

print("ARTORO_AI_BOT set:", bool(os.getenv("ARTORO_AI_BOT")))
print("TELEGRAM_CHAT_ID set:", bool(os.getenv("TELEGRAM_CHAT_ID")))
if os.getenv("TELEGRAM_CHAT_ID"):
    print("TELEGRAM_CHAT_ID value:", os.getenv("TELEGRAM_CHAT_ID"))
