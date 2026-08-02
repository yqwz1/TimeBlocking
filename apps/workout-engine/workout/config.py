"""Paths and configuration loading (zero external deps - JSON config)."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLE_ROOT = getattr(sys, "_MEIPASS", ROOT)
DEFAULT_CONFIG_DIR = os.path.join(BUNDLE_ROOT, "config")
CONFIG_DIR = os.environ.get("TB_WORKOUT_CONFIG_DIR", DEFAULT_CONFIG_DIR)
DATA_DIR = os.environ.get("TB_WORKOUT_DATA_DIR", os.path.join(ROOT, "data"))
OUTPUT_DIR = os.path.join(DATA_DIR, "output")
DB_PATH = os.path.join(DATA_DIR, "workout.db")
SECRETS_PATH = os.path.join(DATA_DIR, "secrets.json")

_cache = {}
_secrets = None


def _load(name):
    if name not in _cache:
        with open(os.path.join(CONFIG_DIR, name), encoding="utf-8") as f:
            _cache[name] = json.load(f)
    return _cache[name]


def settings():
    return _load("settings.json")


def landmarks():
    return _load("landmarks.json")


def priors():
    return _load("priors.json")


def exercises():
    """Return the exercise registry dict keyed by raw Hevy name."""
    return _load("exercises.json")["exercises"]


def canonical_exercise_name(raw_name):
    """Resolve a raw Hevy exercise title through the alias map (see
    config/exercises.json 'aliases'), so a Hevy-side rename or a duplicate
    template for the same movement doesn't split one lift's history in two."""
    return _load("exercises.json").get("aliases", {}).get(raw_name, raw_name)


def exercise_info(raw_name):
    """Look up an exercise; return a sensible default if unmapped (so new
    exercises in future exports never crash the pipeline)."""
    reg = exercises()
    if raw_name in reg:
        return reg[raw_name]
    return {"primary": "other", "secondary": [], "pattern": "isolation",
            "equipment": "other", "_unmapped": True}


def secrets():
    """Load untracked config/secrets.json (API keys etc). Returns {} if absent.
    Never commit this file - it is in .gitignore."""
    global _secrets
    if _secrets is None:
        try:
            with open(SECRETS_PATH, encoding="utf-8") as f:
                _secrets = json.load(f)
        except (FileNotFoundError, ValueError):
            _secrets = {}
    return _secrets


def hevy_api_key():
    """The Hevy API key: env HEVY_API_KEY wins, else config/secrets.json.
    Raises with a clear message if neither is set."""
    key = os.environ.get("HEVY_API_KEY") or secrets().get("hevy_api_key")
    if not key:
        raise RuntimeError(
            "No Hevy API key found. Either set the HEVY_API_KEY environment "
            "variable, or copy config/secrets.example.json to "
            "config/secrets.json and paste your key (from "
            "hevy.com/settings?developer).")
    return key


def hevy_settings():
    """Hevy connection knobs from settings.json (with safe defaults)."""
    base = {"base_url": "https://api.hevyapp.com/v1", "page_size": 10,
            "timeout_seconds": 30, "max_retries": 4}
    base.update(settings().get("hevy", {}))
    return base


def powerlifting():
    """Powerlifting-tab config from settings.json, merged over safe defaults so an
    older settings.json (or a partial block) never crashes the pipeline."""
    base = {
        "lifts": {"squat": "Squat (Barbell)",
                  "bench": "Bench Press (Barbell)",
                  "deadlift": "Deadlift (Barbell)"},
        "bar_weight_kg": 20,
        "plate_pairs_kg": [25, 20, 15, 10, 5, 2.5, 1.25],
        "sex": "male",
        "score": "dots",
        "meet_date": None,
        "attempt_pct": [0.91, 0.96, 1.01],
        "standards": {
            "labels": ["Beginner", "Novice", "Intermediate", "Advanced", "Elite"],
            "bw_mult": {"squat": [0.75, 1.25, 1.5, 2.0, 2.5],
                        "bench": [0.5, 0.75, 1.0, 1.5, 2.0],
                        "deadlift": [1.0, 1.5, 1.75, 2.25, 2.75]}},
    }
    user = settings().get("powerlifting", {})
    base.update({k: v for k, v in user.items() if not k.startswith("_")})
    return base


def ensure_dirs():
    for d in (DATA_DIR, OUTPUT_DIR):
        os.makedirs(d, exist_ok=True)
