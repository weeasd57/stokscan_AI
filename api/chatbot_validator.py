"""
Response Validator
Validates that LLM response only uses data from database.
"""

from typing import Dict, List, Tuple
import re


class ResponseValidator:
    """
    Validates chatbot responses against retrieved data.
    Prevents hallucination by checking:
    1. Ticker mentions
    2. Numeric values
    3. Contradictions
    4. Unsupported claims
    """
    
    def __init__(self):
        # Keywords that indicate speculation
        self.speculation_keywords = [
            "عادةً", "في الغالب", "من المتوقع", "غالباً",
            "probably", "usually", "typically", "expected"
        ]
    
    def validate_response(
        self, 
        user_question: str,
        database_data: Dict,
        draft_response: str
    ) -> Dict:
        """
        Validate draft response against database data.
        
        Returns:
        {
            "valid": bool,
            "violations": List[str],
            "wrong_ticker": bool,
            "wrong_numbers": List[str],
            "unsupported_claims": List[str],
            "contradictions": List[str]
        }
        """
        violations = []
        wrong_numbers = []
        unsupported_claims = []
        contradictions = []
        wrong_ticker = False
        
        # 1. Check ticker correctness
        ticker_violation = self._validate_ticker(user_question, database_data, draft_response)
        if ticker_violation:
            violations.append(ticker_violation)
            wrong_ticker = True
        
        # 2. Check numeric values
        number_violations = self._validate_numbers(database_data, draft_response)
        violations.extend(number_violations)
        wrong_numbers = number_violations
        
        # 3. Check for speculation keywords
        speculation_violations = self._check_speculation(draft_response)
        violations.extend(speculation_violations)
        unsupported_claims = speculation_violations
        
        # 4. Check for contradictions
        contradiction_violations = self._check_contradictions(draft_response, database_data)
        violations.extend(contradiction_violations)
        contradictions = contradiction_violations
        
        return {
            "valid": len(violations) == 0,
            "violations": violations,
            "wrong_ticker": wrong_ticker,
            "wrong_numbers": wrong_numbers,
            "unsupported_claims": unsupported_claims,
            "contradictions": contradictions
        }
    
    def _validate_ticker(self, user_question: str, database_data: Dict, draft_response: str) -> str:
        """Check if response mentions correct ticker."""
        # Extract ticker from question
        question_tickers = re.findall(r'\b[A-Z]{2,6}\b', user_question.upper())
        question_tickers = [t for t in question_tickers if t not in ["EGX", "USD", "RSI", "MACD"]]
        
        # Extract tickers from data
        data_tickers = set()
        if isinstance(database_data, dict):
            if "symbol" in database_data:
                data_tickers.add(database_data["symbol"].upper())
            elif "data" in database_data:
                data = database_data["data"]
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and "symbol" in item:
                            data_tickers.add(item["symbol"].upper())
                elif isinstance(data, dict) and "symbol" in data:
                    data_tickers.add(data["symbol"].upper())
        
        # Extract tickers from response
        response_tickers = re.findall(r'\b[A-Z]{2,6}\b', draft_response.upper())
        response_tickers = [t for t in response_tickers if t not in ["EGX", "USD", "RSI", "MACD", "EGP"]]
        
        # Check if response mentions ticker not in data
        for ticker in response_tickers:
            if data_tickers and ticker not in data_tickers:
                return f"ذكر سهم {ticker} غير موجود في البيانات المسترجعة"
        
        # Check if response answers about wrong ticker
        if question_tickers and data_tickers:
            if not any(qt in data_tickers for qt in question_tickers):
                return f"السؤال عن {question_tickers[0]} لكن البيانات عن {list(data_tickers)}"
        
        return None
    
    def _validate_numbers(self, database_data: Dict, draft_response: str) -> List[str]:
        """Check if numeric values in response match database."""
        violations = []
        
        # Extract numbers from database
        db_values = self._extract_values_from_data(database_data)
        
        # Extract numbers from response
        # Match patterns like "السعر 12.50", "RSI 45.2", etc.
        price_pattern = r'(?:السعر|Price)[:\s]+(\d+\.?\d*)'
        rsi_pattern = r'RSI[:\s]+(\d+\.?\d*)'
        macd_pattern = r'MACD[:\s]+(\d+\.?\d*)'
        volume_pattern = r'(?:الحجم|حجم)[:\s]+(\d+\.?\d*)'
        
        patterns = [
            ("price", price_pattern),
            ("rsi", rsi_pattern),
            ("macd", macd_pattern),
            ("volume_ratio", volume_pattern)
        ]
        
        for field, pattern in patterns:
            matches = re.findall(pattern, draft_response, re.IGNORECASE)
            if matches and field in db_values:
                response_value = float(matches[0])
                db_value = db_values[field]
                
                # Allow small rounding differences
                if abs(response_value - db_value) > 0.1:
                    violations.append(
                        f"{field}: الرد يقول {response_value} لكن البيانات تقول {db_value}"
                    )
        
        return violations
    
    def _extract_values_from_data(self, data: Dict) -> Dict:
        """Extract numeric values from database data."""
        values = {}
        
        if isinstance(data, dict):
            # Single stock data
            if "data" in data:
                actual_data = data["data"]
                if isinstance(actual_data, dict):
                    raw = actual_data.get("raw_data", {})
                    values = {
                        "price": raw.get("price"),
                        "rsi": raw.get("rsi"),
                        "macd": raw.get("macd"),
                        "volume_ratio": raw.get("volume_ratio"),
                        "accumulation_score": raw.get("accumulation_score"),
                        "distribution_score": raw.get("distribution_score")
                    }
                elif isinstance(actual_data, list) and len(actual_data) > 0:
                    # Take first item
                    raw = actual_data[0].get("raw_data", {})
                    values = {
                        "price": raw.get("price"),
                        "rsi": raw.get("rsi"),
                        "macd": raw.get("macd"),
                        "volume_ratio": raw.get("volume_ratio")
                    }
            else:
                # Direct data
                values = {
                    "price": data.get("price") or data.get("close_price"),
                    "rsi": data.get("rsi"),
                    "macd": data.get("macd"),
                    "volume_ratio": data.get("volume_ratio")
                }
        
        # Remove None values
        return {k: v for k, v in values.items() if v is not None}
    
    def _check_speculation(self, draft_response: str) -> List[str]:
        """Check for speculation keywords."""
        violations = []
        
        for keyword in self.speculation_keywords:
            if keyword in draft_response:
                violations.append(f"استخدام عبارة تدل على التخمين: '{keyword}'")
        
        return violations
    
    def _check_contradictions(self, draft_response: str, database_data: Dict) -> List[str]:
        """Check for internal contradictions."""
        violations = []
        
        # Example: volume_ratio < 1 but says "حجم قوي"
        volume_match = re.search(r'(\d+\.?\d*)[xX×]', draft_response)
        if volume_match:
            volume = float(volume_match.group(1))
            
            if volume < 1.0 and any(word in draft_response for word in ["حجم قوي", "سيولة عالية", "تداول نشط"]):
                violations.append(f"تناقض: الحجم {volume}x (ضعيف) لكن الرد يقول 'حجم قوي'")
            
            if volume > 2.0 and any(word in draft_response for word in ["حجم ضعيف", "سيولة منخفضة"]):
                violations.append(f"تناقض: الحجم {volume}x (قوي) لكن الرد يقول 'حجم ضعيف'")
        
        # Example: RSI > 70 but says "فرصة شراء"
        rsi_match = re.search(r'RSI[:\s]+(\d+\.?\d*)', draft_response, re.IGNORECASE)
        if rsi_match:
            rsi = float(rsi_match.group(1))
            
            if rsi > 70 and any(word in draft_response for word in ["فرصة شراء", "فرصة قوية", "موصى به"]):
                violations.append(f"تناقض: RSI {rsi} (تشبع شرائي) لكن الرد يوصي بالشراء")
        
        return violations


def validate_and_fix(
    user_question: str,
    database_data: Dict,
    draft_response: str,
    max_retries: int = 2
) -> Tuple[str, Dict]:
    """
    Validate response and provide fix suggestions.
    
    Returns:
    - (final_response, validation_result)
    """
    validator = ResponseValidator()
    
    validation = validator.validate_response(user_question, database_data, draft_response)
    
    if validation["valid"]:
        return draft_response, validation
    
    # If invalid, return validation errors
    # In production, could retry with LLM here
    return draft_response, validation
