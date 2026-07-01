import time
import threading
from typing import Any, Dict, Optional, Tuple


class TTLCache:
    """Thread-safe in-memory TTL cache."""
    __slots__ = ("_store", "_lock", "_default_ttl")

    def __init__(self, default_ttl: int = 300):
        self._store: Dict[str, Tuple[float, Any]] = {}
        self._lock = threading.RLock()
        self._default_ttl = default_ttl

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            item = self._store.get(key)
            if item is None:
                return None
            ts, value = item
            if time.time() - ts > self._default_ttl:
                del self._store[key]
                return None
            return value

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        with self._lock:
            self._store[key] = (time.time(), value)

    def invalidate(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


# Module-level caches with sensible TTLs
inventory_cache = TTLCache(default_ttl=300)       # 5 minutes
countries_cache = TTLCache(default_ttl=600)       # 10 minutes
model_cards_cache = TTLCache(default_ttl=1800)    # 30 minutes
health_cache = TTLCache(default_ttl=60)           # 1 minute (for load balancer warmup)
