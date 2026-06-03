import os
import requests
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("whatsapp_service")

# Ensure logs directory exists
os.makedirs("logs", exist_ok=True)
WHATSAPP_LOG_PATH = "logs/whatsapp_messages.log"

class WhatsAppService:
    def __init__(self):
        self.access_token = os.getenv("WHATSAPP_ACCESS_TOKEN")
        self.phone_number_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
        self.enabled = bool(self.access_token and self.phone_number_id)
        
    def send_message(self, to_number: str, message: str) -> bool:
        """
        Send a WhatsApp message.
        If WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are configured, 
        sends using the official Meta WhatsApp Cloud API.
        Otherwise, simulates the send by writing to logs/whatsapp_messages.log.
        """
        # Normalize phone number (strip whitespace, +, etc.)
        phone = "".join(filter(str.isdigit, to_number.strip()))
        if not phone:
            logger.error("Invalid phone number provided for WhatsApp")
            return False
            
        if self.enabled:
            try:
                url = f"https://graph.facebook.com/v18.0/{self.phone_number_id}/messages"
                headers = {
                    "Authorization": f"Bearer {self.access_token}",
                    "Content-Type": "application/json"
                }
                payload = {
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": phone,
                    "type": "text",
                    "text": {
                        "body": message
                    }
                }
                
                logger.info(f"Sending WhatsApp message to {phone} via Cloud API...")
                res = requests.post(url, headers=headers, json=payload, timeout=10)
                
                if res.status_code in [200, 201]:
                    logger.info(f"WhatsApp message sent successfully to {phone}")
                    return True
                else:
                    logger.error(f"WhatsApp API failed with status {res.status_code}: {res.text}")
                    # Fallback to simulation log on failure
                    self._log_simulated_message(phone, message, error=res.text)
                    return False
            except Exception as e:
                logger.error(f"WhatsApp API connection error: {e}")
                self._log_simulated_message(phone, message, error=str(e))
                return False
        else:
            # Simulated Gateway
            return self._log_simulated_message(phone, message)

    def _log_simulated_message(self, phone: str, message: str, error: Optional[str] = None) -> bool:
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        status = "SIMULATED" if not error else f"FAILED ({error})"
        log_entry = (
            f"========================================\n"
            f"TIME: {ts}\n"
            f"TO: +{phone}\n"
            f"STATUS: {status}\n"
            f"MESSAGE:\n{message}\n"
            f"========================================\n\n"
        )
        try:
            with open(WHATSAPP_LOG_PATH, "a", encoding="utf-8") as f:
                f.write(log_entry)
            print(f"[WhatsApp Simulated Gateway] Logged message to +{phone} in {WHATSAPP_LOG_PATH}")
            return True
        except Exception as e:
            logger.error(f"Failed to write to WhatsApp log file: {e}")
            return False

# Global instance
whatsapp_service = WhatsAppService()
