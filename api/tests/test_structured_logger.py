"""
Unit Tests for Structured JSON Logger
"""

import logging
import json
import os
import pytest
from datetime import datetime

from api.structured_logger import StructuredLogger, JSONFormatter
from api.trading_config import TradingParameters
from api.unified_features import DataReadinessReport


def test_json_formatter_normal_message():
    """Verify that JSONFormatter structures regular text log messages correctly"""
    formatter = JSONFormatter()
    logger = logging.getLogger("test_formatter_regular")
    record = logging.LogRecord(
        name=logger.name,
        level=logging.INFO,
        pathname="test.py",
        lineno=10,
        msg="Hello World",
        args=(),
        exc_info=None
    )
    formatted = formatter.format(record)
    data = json.loads(formatted)
    
    assert "timestamp" in data
    assert data["level"] == "INFO"
    assert data["logger"] == "test_formatter_regular"
    assert data["message"] == "Hello World"


def test_json_formatter_json_message():
    """Verify that JSONFormatter merges JSON log messages without nesting double-encodings"""
    formatter = JSONFormatter()
    logger = logging.getLogger("test_formatter_json")
    payload = {
        "event": "test_event",
        "value": 42
    }
    record = logging.LogRecord(
        name=logger.name,
        level=logging.WARNING,
        pathname="test.py",
        lineno=20,
        msg=json.dumps(payload),
        args=(),
        exc_info=None
    )
    formatted = formatter.format(record)
    data = json.loads(formatted)
    
    assert "timestamp" in data
    assert data["level"] == "WARNING"
    assert data["logger"] == "test_formatter_json"
    assert data["event"] == "test_event"
    assert data["value"] == 42
    assert "message" not in data


def test_structured_logger_event_methods(tmp_path):
    """Verify event-specific logging methods write correct keys to log file"""
    log_file = os.path.join(tmp_path, "test_structured.json")
    struct_logger = StructuredLogger("test_struct_events", log_file=log_file)
    
    # 1. Test log_parameter_load
    params = TradingParameters(
        entry_mode="next_open",
        barrier_mode="percent",
        target_pct=0.08,
        stop_loss_pct=0.03,
        king_threshold=0.80
    )
    struct_logger.log_parameter_load("test_module", params)
    
    # 2. Test log_data_readiness
    report = DataReadinessReport(
        is_ready=True,
        bars_count=100,
        min_bars_required=50,
        nan_percentage=0.01,
        warnings=["Light warning"]
    )
    struct_logger.log_data_readiness("COMI.CA", report)
    
    # 3. Test log_barrier_calculation
    struct_logger.log_barrier_calculation(100.0, 108.0, 97.0)
    
    # 4. Test log_egx30_regime
    struct_logger.log_egx30_regime("2026-06-12", "trending_up", 0.015)
    
    # Force handlers to flush and close to write all logs
    for handler in struct_logger.logger.handlers:
        handler.flush()
        handler.close()
        
    # Read the log file and verify JSON records
    assert os.path.exists(log_file)
    with open(log_file, "r", encoding="utf-8") as f:
        lines = f.readlines()
        
    assert len(lines) == 4
    
    # Verify parameter load log
    d0 = json.loads(lines[0])
    assert d0["event"] == "parameters_loaded"
    assert d0["source"] == "test_module"
    assert d0["entry_mode"] == "next_open"
    assert d0["barrier_mode"] == "percent"
    assert d0["target_pct"] == 0.08
    assert d0["stop_loss_pct"] == 0.03
    assert d0["king_threshold"] == 0.80
    
    # Verify data readiness log
    d1 = json.loads(lines[1])
    assert d1["event"] == "data_validation"
    assert d1["symbol"] == "COMI.CA"
    assert d1["is_ready"] is True
    assert d1["bars_count"] == 100
    assert d1["nan_percentage"] == 0.01
    assert d1["warnings"] == ["Light warning"]
    
    # Verify barrier calculation log
    d2 = json.loads(lines[2])
    assert d2["event"] == "barriers_calculated"
    assert d2["entry_price"] == 100.0
    assert d2["take_profit"] == 108.0
    assert d2["stop_loss"] == 97.0
    assert d2["risk_reward_ratio"] == 8.0 / 3.0
    
    # Verify EGX30 regime log
    d3 = json.loads(lines[3])
    assert d3["event"] == "market_regime"
    assert d3["date"] == "2026-06-12"
    assert d3["regime"] == "trending_up"
    assert d3["egx30_return"] == 0.015
