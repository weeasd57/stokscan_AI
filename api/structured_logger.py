"""
Structured JSON Logger Module

Provides structured JSON format logging for trading pipelines, including
training, backtesting, and live bot execution, aligning with EGX specifications.
"""

import logging
import json
import os
from datetime import datetime
from typing import Dict, Any, Optional

from api.trading_config import TradingParameters
from api.unified_features import DataReadinessReport


class JSONFormatter(logging.Formatter):
    """Custom logging formatter to output log records in structured JSON format"""
    
    def format(self, record: logging.LogRecord) -> str:
        message = record.getMessage()
        try:
            # Try parsing message as JSON to avoid double encoding
            msg_data = json.loads(message)
            if not isinstance(msg_data, dict):
                msg_data = {"message": message}
        except (ValueError, TypeError):
            msg_data = {"message": message}
            
        log_data = {
            "timestamp": datetime.fromtimestamp(record.created).isoformat() if hasattr(record, "created") else datetime.now().isoformat(),
            "level": record.levelname,
            "logger": record.name,
            **msg_data
        }
        
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)
            
        return json.dumps(log_data)


class StructuredLogger:
    """JSON-structured logging for log aggregation tools"""
    
    def __init__(self, name: str, log_file: Optional[str] = "logs/structured.json"):
        self.logger = logging.getLogger(name)
        self.logger.setLevel(logging.INFO)
        
        # Avoid adding duplicate handlers if already initialized
        if not self.logger.handlers:
            # Console handler
            console_handler = logging.StreamHandler()
            console_handler.setFormatter(JSONFormatter())
            self.logger.addHandler(console_handler)
            
            # File handler (optional)
            if log_file:
                log_dir = os.path.dirname(log_file)
                if log_dir and not os.path.exists(log_dir):
                    os.makedirs(log_dir, exist_ok=True)
                file_handler = logging.FileHandler(log_file, encoding="utf-8")
                file_handler.setFormatter(JSONFormatter())
                self.logger.addHandler(file_handler)
                
    def log_parameter_load(self, source: str, params: TradingParameters):
        """Log parameter loading events"""
        self.logger.info(json.dumps({
            "event": "parameters_loaded",
            "source": source,
            "entry_mode": params.entry_mode,
            "barrier_mode": params.barrier_mode,
            "target_pct": params.target_pct,
            "stop_loss_pct": params.stop_loss_pct,
            "king_threshold": params.king_threshold
        }))
        
    def log_data_readiness(self, symbol: str, report: DataReadinessReport):
        """Log data validation results"""
        self.logger.info(json.dumps({
            "event": "data_validation",
            "symbol": symbol,
            "is_ready": report.is_ready,
            "bars_count": report.bars_count,
            "nan_percentage": report.nan_percentage,
            "warnings": report.warnings
        }))
        
    def log_barrier_calculation(self, entry_price: float, tp: float, sl: float):
        """Log barrier calculations"""
        # Note: spec says debug, but we can also use info if we want it visible
        r_r = (tp - entry_price) / (entry_price - sl) if (entry_price - sl) != 0 else 0.0
        self.logger.info(json.dumps({
            "event": "barriers_calculated",
            "entry_price": entry_price,
            "take_profit": tp,
            "stop_loss": sl,
            "risk_reward_ratio": r_r
        }))
        
    def log_egx30_regime(self, date: str, regime: str, egx30_return: float):
        """Log market regime classification"""
        self.logger.info(json.dumps({
            "event": "market_regime",
            "date": date,
            "regime": regime,
            "egx30_return": egx30_return
        }))

    def log_generic(self, level: int, event: str, details: str = "", parameters: Optional[Dict[str, Any]] = None, **kwargs):
        """Log generic event with extra fields"""
        payload = {
            "event": event,
            "details": details,
            "parameters": parameters or {}
        }
        payload.update(kwargs)
        self.logger.log(level, json.dumps(payload))
        
    def info(self, event: str, details: str = "", parameters: Optional[Dict[str, Any]] = None, **kwargs):
        self.log_generic(logging.INFO, event, details, parameters, **kwargs)
        
    def warning(self, event: str, details: str = "", parameters: Optional[Dict[str, Any]] = None, **kwargs):
        self.log_generic(logging.WARNING, event, details, parameters, **kwargs)
        
    def error(self, event: str, details: str = "", parameters: Optional[Dict[str, Any]] = None, **kwargs):
        self.log_generic(logging.ERROR, event, details, parameters, **kwargs)
