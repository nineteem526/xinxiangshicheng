"""Strict validation of model output. The model may only fill data fields."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ACCENTS = ("#00f0ff", "#ff2bd6", "#7dff6b", "#ffb300", "#ff4d4d")
Gesture = Literal["Open_Palm", "Closed_Fist", "Victory"]
Accent = Literal["#00f0ff", "#ff2bd6", "#7dff6b", "#ffb300", "#ff4d4d"]
MAX_RIFTS = 4


def _no_markup(v: str) -> str:
    if any(c in v for c in "<>{}`"):
        raise ValueError("markup/code characters not allowed")
    return v.strip()


class Lines(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: str = Field(min_length=1, max_length=40)
    success: str = Field(min_length=1, max_length=40)
    failure: str = Field(min_length=1, max_length=40)


class LevelOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    object: str = Field(min_length=1, max_length=12)
    fantasyName: str = Field(min_length=1, max_length=14)
    theme: str = Field(min_length=1, max_length=12)
    mission: str = Field(min_length=1, max_length=40)
    story: str = Field(min_length=1, max_length=120)
    duration: int = Field(ge=30, le=90)
    difficulty: Literal[1, 2, 3]
    weakness: Gesture
    accent: Accent
    lines: Lines

    @field_validator("object", "fantasyName", "theme", "mission", "story")
    @classmethod
    def no_markup(cls, v: str) -> str:
        return _no_markup(v)


class Rift(BaseModel):
    """One real object in the frame. box = [ymin, xmin, ymax, xmax] in 0..1000 of the image."""
    model_config = ConfigDict(extra="forbid")
    object: str = Field(min_length=1, max_length=12)
    fantasyName: str = Field(min_length=1, max_length=14)
    weakness: Gesture
    box: list[int] = Field(min_length=4, max_length=4)

    @field_validator("object", "fantasyName")
    @classmethod
    def no_markup(cls, v: str) -> str:
        return _no_markup(v)

    @field_validator("box")
    @classmethod
    def sane_box(cls, b: list[int]) -> list[int]:
        ymin, xmin, ymax, xmax = b
        if not all(0 <= v <= 1000 for v in b):
            raise ValueError("box out of range")
        if ymax - ymin < 30 or xmax - xmin < 30:
            raise ValueError("box too small")
        return b


class SceneOut(BaseModel):
    """A whole-table level: shared story plus 1..MAX_RIFTS rifts anchored to real objects."""
    model_config = ConfigDict(extra="forbid")
    theme: str = Field(min_length=1, max_length=12)
    mission: str = Field(min_length=1, max_length=40)
    story: str = Field(min_length=1, max_length=120)
    duration: int = Field(ge=30, le=90)
    difficulty: Literal[1, 2, 3]
    accent: Accent
    lines: Lines
    rifts: list[Rift] = Field(min_length=1, max_length=MAX_RIFTS)

    @field_validator("theme", "mission", "story")
    @classmethod
    def no_markup(cls, v: str) -> str:
        return _no_markup(v)

    @model_validator(mode="after")
    def unique_objects(self):
        names = [r.object for r in self.rifts]
        if len(set(names)) != len(names):
            raise ValueError("duplicate rift objects")
        return self


_ALIAS = {"fantasy_name": "fantasyName", "world_theme": "theme"}


def _normalize(raw: dict) -> dict:
    raw = {_ALIAS.get(k, k): v for k, v in raw.items()}
    raw.pop("required_gestures", None)
    return raw


def validate_level(raw: dict, source: Literal["ai", "manual"]) -> dict:
    """Validate a single-object level; return a Level dict with server-set source."""
    out = LevelOut.model_validate(_normalize(raw)).model_dump()
    out["source"] = source
    return out


def validate_scene(raw: dict) -> dict:
    """Validate a multi-object scene and flatten it into the Level shape the client already knows."""
    sc = SceneOut.model_validate(_normalize(raw))
    first = sc.rifts[0]
    return {
        "object": "、".join(r.object for r in sc.rifts)[:12],
        "fantasyName": first.fantasyName,
        "theme": sc.theme,
        "mission": sc.mission,
        "story": sc.story,
        "duration": sc.duration,
        "difficulty": sc.difficulty,
        "weakness": first.weakness,
        "accent": sc.accent,
        "lines": sc.lines.model_dump(),
        "rifts": [r.model_dump() for r in sc.rifts],
        "source": "ai",
    }
