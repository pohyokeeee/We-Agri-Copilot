"""POST /voice/asr (the recording in, a transcript out) and POST /voice/tts (a reply in, an audio URL out).
Both fail softly: with LLM_MOCK=1, no key or a slow model the app keeps working on typed text and printed replies."""
import re
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.config import settings
from app.db import get_session
from app.llm import qwen
from app.mockbank import service as svc
from app.voice import asr, tts

router = APIRouter(prefix="/voice", tags=["voice (Qwen ASR / TTS)"])
MAX_AUDIO = 5 * 1024 * 1024  # a push-to-talk clip is a few seconds of mp3, far below this
SOFT = {"asr": "语音识别现在用不了，请直接打字。", "tts": "语音播报现在用不了，请看文字。"}


def _off(kind: str) -> HTTPException:
    return HTTPException(503, SOFT[kind])


@router.post("/asr")
async def transcribe(request: Request, customer_id: int = 1, s: Session = Depends(get_session)):
    """Body = the raw audio bytes (Content-Type audio/mpeg from Taro's recorder, or audio/wav)."""
    if not qwen.enabled():
        raise _off("asr")
    if int(request.headers.get("content-length") or 0) > MAX_AUDIO:
        raise HTTPException(413, "录音太长了")
    audio = await request.body()
    if not audio:
        raise HTTPException(400, "没有收到录音")
    if len(audio) > MAX_AUDIO:
        raise HTTPException(413, "录音太长了")
    mime = {"audio/mp3": "audio/mpeg", "audio/mpeg": "audio/mpeg", "audio/wav": "audio/wav", "audio/x-wav": "audio/wav"}.get(
        request.headers.get("content-type", "").split(";")[0].strip().lower(), "audio/mpeg")
    cust, _ = svc.get_customer(s, customer_id)
    names = asr.glossary(s, customer_id)
    started = time.time()
    try:
        out = await run_in_threadpool(asr.transcribe, audio, mime, names)
    except qwen.LLMError as e:
        raise HTTPException(502, SOFT["asr"]) from e
    svc.audit_step(s, "voice_asr", cust.id, actor="asr", method=settings.llm_asr, result=("needs confirm" if out["needs_confirm"] else "heard"),
                   utterance=out["transcript"], confidence=out["confidence"], needs_confirm=out["needs_confirm"],
                   reasons=out["reasons"], seconds=round(time.time() - started, 2), audio_bytes=len(audio))
    s.commit()
    return out


class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=300)


@router.post("/tts")
async def speak(body: TtsIn):
    """The clip starts with 元农民助手：. Returns where to fetch it; the second call for the same text is a cache hit.
    204 when the selected provider has no speech synthesis (Groq): the app then shows the reply as large text instead."""
    if settings.llm_provider == "groq":
        return Response(status_code=204)
    started = time.time()
    try:
        name, spoken, cached = await run_in_threadpool(tts.synthesize, body.text)
    except qwen.LLMError as e:
        raise (_off("tts") if not qwen.enabled() else HTTPException(502, SOFT["tts"])) from e
    return {"audio_url": f"/voice/audio/{name}", "cached": cached, "spoken_text": spoken, "seconds": round(time.time() - started, 2)}


@router.get("/audio/{name}")
def audio(name: str):
    if not re.fullmatch(r"[0-9a-f]{32}\.(wav|mp3)", name):
        raise HTTPException(404, "no such clip")
    path = Path(settings.tts_cache_dir) / name
    if not path.exists():
        raise HTTPException(404, "no such clip")
    return FileResponse(path, media_type="audio/wav" if name.endswith(".wav") else "audio/mpeg")
