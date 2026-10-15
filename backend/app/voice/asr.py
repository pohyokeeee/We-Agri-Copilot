"""Speech-to-text (Mandarin, older speakers, dialect-tolerant)."""


def transcribe(audio: bytes, mime: str = "audio/mp3") -> str:
    """Return the transcript. Transcripts are untrusted user text like any other input."""
    # TODO: Model Studio ASR (e.g. paraformer) behind the same base URL/key
    raise NotImplementedError
