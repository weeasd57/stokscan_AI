"""Durable, compare-and-set checkpoints on the private short_swing_checkpoints ledger.

Read failures fail closed. The unique checkpoint_key arbitrates first
claims; version filters arbitrate subsequent claims across HF processes.
"""
import uuid
from datetime import datetime, timezone


def utc_now():
    return datetime.now(timezone.utc)


def parse_timestamp(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def read_checkpoint(client, key):
    if not client:
        raise RuntimeError('Checkpoint client unavailable')
    result = (client.table('short_swing_checkpoints').select('payload,computed_at')
              .eq('checkpoint_key', key).limit(1).execute())
    rows = result.data or []
    return rows[0] if rows else None


def replace_checkpoint(client, key, payload, expected):
    """Write only over the row read by this caller; return the verified row."""
    version = str(uuid.uuid4())
    row = {'checkpoint_key': key,
           'payload': {**payload, '_version': version}, 'computed_at': utc_now().isoformat()}
    if expected is None:
        try:
            client.table('short_swing_checkpoints').insert(row).execute()
        except Exception:
            # A lost insert response or race grants no permission to send.
            return None
    else:
        query = client.table('short_swing_checkpoints').update(row).eq('checkpoint_key', key)
        old_version = (expected.get('payload') or {}).get('_version')
        if old_version:
            query = query.eq('payload->>_version', old_version)
        else:
            query = query.eq('computed_at', expected['computed_at'])
        query.execute()
    saved = read_checkpoint(client, key)
    return saved if saved and saved.get('payload', {}).get('_version') == version else None
