"""Date parsing and bucketing helpers for Hevy timestamps."""
from datetime import datetime, timedelta

HEVY_FMT = "%d %b %Y, %H:%M"


def parse_hevy(s):
    """Parse '30 Aug 2025, 21:26' -> datetime, or None."""
    if not s:
        return None
    try:
        return datetime.strptime(s.strip(), HEVY_FMT)
    except ValueError:
        return None


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S") if dt else None


def from_iso(s):
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return None


def parse_api(s):
    """Parse a Hevy API ISO-8601 timestamp (e.g. '2025-08-30T19:26:00+00:00' or
    '...Z') into a NAIVE LOCAL datetime, matching the wall-clock the CSV export
    uses. The API stamps in UTC; the CSV stamps bare local time. Converting to
    local before stripping the tz keeps the (start_time, ...) dedup key aligned
    across both sources so a workout present in both lands on one row."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone().replace(tzinfo=None)  # -> local wall clock, naive
    return dt


def day(dt):
    return dt.strftime("%Y-%m-%d") if dt else None


def month(dt):
    return dt.strftime("%Y-%m") if dt else None


def iso_week(dt):
    """ISO year-week label, e.g. '2025-W35'."""
    y, w, _ = dt.isocalendar()
    return f"{y}-W{w:02d}"


def week_start(dt):
    """Monday of the dt's ISO week, at 00:00."""
    monday = dt - timedelta(days=dt.weekday())
    return monday.replace(hour=0, minute=0, second=0, microsecond=0)
