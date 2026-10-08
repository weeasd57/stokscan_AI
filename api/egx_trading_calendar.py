"""Confirmed EGX closures; never infer exchange holidays from civil holidays.

Additional announced dates can be configured with EGX_HOLIDAY_DATES (CSV,
YYYY-MM-DD). Keep this local: scheduling must not fetch a calendar per tick.
"""
import os
from datetime import date

# EGX announcement dated 2026-10-05: trading resumes Sunday, October 11.
# https://www.sigma-cap.com/main/news_page_exact?newsId=46118692&newsType=EGX
CONFIRMED_CLOSURES = {date(2026, 10, 8)}


def is_egx_session(day):
    if hasattr(day, 'date'):
        day = day.date()
    closures = set(CONFIRMED_CLOSURES)
    for value in os.getenv('EGX_HOLIDAY_DATES', '').split(','):
        if value.strip():
            # Invalid configuration fails closed rather than silently trading.
            closures.add(date.fromisoformat(value.strip()))
    return day.weekday() not in {4, 5} and day not in closures
