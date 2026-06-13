"""Canonical EGX model selection for public-facing APIs."""

from typing import Any, Dict, List, Optional


def _name(m: Dict[str, Any]) -> str:
    return str(m.get("name") or m.get("model_name") or "")


def _name_upper(m: Dict[str, Any]) -> str:
    return _name(m).upper()


def select_canonical_model_cards(models: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Return at most KING + THE BRAIN (NANO) models, plus any custom models."""
    king_pool = []
    brain_pool = []
    others = []

    for m in models or []:
        n = _name_upper(m)
        if "KING" in n and not any(x in n for x in ("COUNCIL", "VALIDATOR", "ADVISOR")):
            compact = n.replace(" ", "")
            if compact.startswith("KINGF") and any(ch.isdigit() for ch in compact[4:]):
                continue
            king_pool.append(m)
        elif "BRAIN" in n or "NANO" in n or "NEW_MODEL" in n:
            brain_pool.append(m)
        else:
            others.append(m)

    def _pick(pool: List[Dict[str, Any]], preferred: List[str]) -> Optional[Dict[str, Any]]:
        if not pool:
            return None
        for pref in preferred:
            for m in pool:
                name = _name(m)
                if name == pref or pref in name:
                    return m
        return sorted(
            pool,
            key=lambda m: (
                -float(m.get("size_mb") or 0),
                -len(_name(m)),
            ),
        )[0]

    picked: List[Dict[str, Any]] = []
    king = _pick(king_pool, ["KING 👑.pkl", "KING.pkl"])
    brain = _pick(brain_pool, ["THE BRAIN.pkl", "NANO"])
    if king:
        picked.append(king)
    if brain:
        picked.append(brain)
    picked.extend(others)
    return picked
