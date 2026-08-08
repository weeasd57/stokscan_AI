"""
Opportunity Analysis Engine
Calculates opportunity scores based on technical indicators without LLM hallucination.
"""

from typing import List, Dict, Optional, Tuple
from datetime import datetime, timedelta


class OpportunityAnalyzer:
    """
    Technical analysis engine that scores stocks based on data, not LLM invention.
    """
    
    def __init__(self):
        # Technical thresholds
        self.RSI_OVERSOLD = 30
        self.RSI_OVERBOUGHT = 70
        self.RSI_NEUTRAL_LOW = 40
        self.RSI_NEUTRAL_HIGH = 60
        
        self.VOLUME_SPIKE_THRESHOLD = 1.5  # 1.5x average
        self.ACCUMULATION_THRESHOLD = 70
        self.DISTRIBUTION_THRESHOLD = 30
        
        # Price position thresholds
        self.PRICE_NEAR_SUPPORT_PCT = 0.05  # Within 5% of support
        self.PRICE_NEAR_RESISTANCE_PCT = 0.05  # Within 5% of resistance
    
    def calculate_weekly_opportunity_score(self, stock_data: Dict) -> Dict:
        """
        Calculate opportunity score for weekly prediction.
        
        Parameters:
        - stock_data: Dictionary with keys like:
            - symbol, close_price, rsi, macd, volume_ratio, 
            - accumulation_score, distribution_score, support, resistance
            - trend_5d, trend_20d
        
        Returns:
        - Dictionary with score, reasons, risks, and recommendation
        """
        score = 0
        reasons = []
        risks = []
        
        symbol = stock_data.get("symbol", "UNKNOWN")
        price = stock_data.get("close_price", 0)
        rsi = stock_data.get("rsi")
        macd = stock_data.get("macd")
        volume_ratio = stock_data.get("volume_ratio", 1.0)
        acc_score = stock_data.get("accumulation_score", 0)
        dist_score = stock_data.get("distribution_score", 0)
        support = stock_data.get("support")
        resistance = stock_data.get("resistance")
        
        # 1. Accumulation Analysis (0-30 points)
        if acc_score > 80:
            score += 30
            reasons.append(f"تجميع قوي جداً: {acc_score:.1f}")
        elif acc_score > 70:
            score += 25
            reasons.append(f"تجميع قوي: {acc_score:.1f}")
        elif acc_score > 50:
            score += 15
            reasons.append(f"تجميع متوسط: {acc_score:.1f}")
        
        # 2. Distribution Check (negative score)
        if dist_score > 70:
            score -= 25
            risks.append(f"تصريف قوي: {dist_score:.1f}")
        elif dist_score > 50:
            score -= 15
            risks.append(f"تصريف متوسط: {dist_score:.1f}")
        
        # 3. Volume Analysis (0-20 points)
        if volume_ratio > 3.0:
            score += 20
            reasons.append(f"حجم تداول ضخم: {volume_ratio:.2f}x")
        elif volume_ratio > 2.0:
            score += 15
            reasons.append(f"حجم تداول قوي: {volume_ratio:.2f}x")
        elif volume_ratio > 1.5:
            score += 10
            reasons.append(f"حجم تداول جيد: {volume_ratio:.2f}x")
        elif volume_ratio < 0.5:
            score -= 10
            risks.append(f"حجم تداول ضعيف: {volume_ratio:.2f}x")
        
        # 4. RSI Analysis (0-15 points)
        if rsi is not None:
            if self.RSI_NEUTRAL_LOW <= rsi <= self.RSI_NEUTRAL_HIGH:
                score += 15
                reasons.append(f"RSI محايد صحي: {rsi:.1f}")
            elif rsi < self.RSI_OVERSOLD:
                score += 10
                reasons.append(f"RSI تشبع بيعي (فرصة): {rsi:.1f}")
            elif rsi > self.RSI_OVERBOUGHT:
                score -= 15
                risks.append(f"RSI تشبع شرائي (خطر): {rsi:.1f}")
        
        # 5. MACD Signal (0-10 points)
        if macd is not None:
            if macd > 0:
                score += 10
                reasons.append(f"MACD إيجابي: {macd:.4f}")
            elif macd < 0:
                score -= 5
                risks.append(f"MACD سلبي: {macd:.4f}")
        
        # 6. Price Position (0-15 points)
        if support and resistance and price:
            price_range = resistance - support
            if price_range > 0:
                distance_from_support = (price - support) / price_range
                
                # Near support is good
                if distance_from_support < self.PRICE_NEAR_SUPPORT_PCT:
                    score += 15
                    reasons.append(f"السعر قريب من الدعم ({support:.2f})")
                
                # Near resistance is bad
                elif distance_from_support > (1 - self.PRICE_NEAR_RESISTANCE_PCT):
                    score -= 15
                    risks.append(f"السعر قريب من المقاومة ({resistance:.2f})")
        
        # Normalize score to 0-100
        final_score = max(0, min(100, score + 50))  # Shift baseline to 50
        
        # Generate recommendation
        recommendation = self._generate_recommendation(final_score, reasons, risks)
        
        return {
            "symbol": symbol,
            "score": round(final_score, 1),
            "reasons": reasons,
            "risks": risks,
            "recommendation": recommendation,
            "raw_data": {
                "price": price,
                "rsi": rsi,
                "macd": macd,
                "volume_ratio": volume_ratio,
                "accumulation_score": acc_score,
                "distribution_score": dist_score,
                "support": support,
                "resistance": resistance
            }
        }
    
    def _generate_recommendation(self, score: float, reasons: List[str], risks: List[str]) -> str:
        """Generate human-readable recommendation based on score."""
        if score >= 80:
            return "فرصة قوية جداً ⭐⭐⭐"
        elif score >= 65:
            return "فرصة جيدة ⭐⭐"
        elif score >= 50:
            return "فرصة متوسطة ⭐"
        elif score >= 35:
            return "مراقبة 👀"
        else:
            return "تجنب ❌"
    
    def rank_opportunities(self, stocks_data: List[Dict], top_n: int = 5) -> List[Dict]:
        """
        Analyze multiple stocks and return top opportunities.
        """
        analyzed = []
        
        for stock in stocks_data:
            analysis = self.calculate_weekly_opportunity_score(stock)
            analyzed.append(analysis)
        
        # Sort by score descending
        analyzed.sort(key=lambda x: x["score"], reverse=True)
        
        return analyzed[:top_n]
    
    def filter_by_criteria(
        self, 
        stocks_data: List[Dict], 
        min_accumulation: Optional[float] = None,
        max_distribution: Optional[float] = None,
        below_midpoint: bool = False
    ) -> List[Dict]:
        """
        Filter stocks by specific criteria.
        
        Parameters:
        - min_accumulation: Minimum accumulation score
        - max_distribution: Maximum distribution score
        - below_midpoint: Only include stocks trading below technical midpoint
        """
        filtered = []
        
        for stock in stocks_data:
            # Check accumulation
            if min_accumulation is not None:
                if stock.get("accumulation_score", 0) < min_accumulation:
                    continue
            
            # Check distribution
            if max_distribution is not None:
                if stock.get("distribution_score", 100) > max_distribution:
                    continue
            
            # Check price position
            if below_midpoint:
                support = stock.get("support")
                resistance = stock.get("resistance")
                price = stock.get("close_price")
                
                if support and resistance and price:
                    midpoint = (support + resistance) / 2
                    if price >= midpoint:
                        continue
            
            filtered.append(stock)
        
        return filtered
    
    def format_response_for_llm(self, analysis_results: List[Dict]) -> str:
        """
        Format analysis results in a way that prevents LLM hallucination.
        This provides the LLM with pre-computed facts only.
        """
        if not analysis_results:
            return "لا توجد بيانات متاحة للتحليل."
        
        response_parts = []
        response_parts.append("📊 **التحليل الفني للأسهم** (من قاعدة البيانات)\n")
        
        for idx, result in enumerate(analysis_results, 1):
            symbol = result["symbol"]
            score = result["score"]
            recommendation = result["recommendation"]
            raw = result["raw_data"]
            
            part = f"\n**{idx}. {symbol}** — {recommendation} (نقاط الفرصة: {score})\n"
            part += f"• السعر: {raw['price']:.2f} جنيه\n"
            
            if raw.get("rsi") is not None:
                part += f"• RSI: {raw['rsi']:.1f}\n"
            
            if raw.get("macd") is not None:
                part += f"• MACD: {raw['macd']:.4f}\n"
            
            part += f"• حجم التداول: {raw['volume_ratio']:.2f}x من المتوسط\n"
            
            if raw.get("accumulation_score"):
                part += f"• التجميع: {raw['accumulation_score']:.1f}\n"
            
            if raw.get("distribution_score"):
                part += f"• التصريف: {raw['distribution_score']:.1f}\n"
            
            if raw.get("support") and raw.get("resistance"):
                part += f"• الدعم: {raw['support']:.2f} | المقاومة: {raw['resistance']:.2f}\n"
            
            # Reasons
            if result["reasons"]:
                part += f"\n✅ **الأسباب الإيجابية:**\n"
                for reason in result["reasons"]:
                    part += f"  - {reason}\n"
            
            # Risks
            if result["risks"]:
                part += f"\n⚠️ **المخاطر:**\n"
                for risk in result["risks"]:
                    part += f"  - {risk}\n"
            
            response_parts.append(part)
        
        return "\n".join(response_parts)
