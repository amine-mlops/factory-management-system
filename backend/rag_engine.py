"""Keyword-overlap RAG over demo/docs/*.pdf (pypdf). Chunks are tagged
role='executive'; driver queries drop them BEFORE similarity ranking.
No vector DB by design - startup index + lexical scoring."""
import re
from pathlib import Path

from pypdf import PdfReader


class RagEngine:
    def __init__(self, docs_dir):
        self.docs_dir = Path(docs_dir)
        self.chunks: list[dict] = []

    def index(self) -> int:
        """Index every PDF in docs_dir; chunk by paragraph. Missing/corrupt
        docs are skipped gracefully (empty index is valid)."""
        self.chunks = []
        if not self.docs_dir.is_dir():
            return 0
        for pdf in sorted(self.docs_dir.glob("*.pdf")):
            try:
                reader = PdfReader(str(pdf))
                text = "\n".join((p.extract_text() or "") for p in reader.pages)
            except Exception:
                continue
            for para in re.split(r"\n\s*\n", text):
                para = " ".join(para.split())
                if para:
                    self.chunks.append(
                        {"source": pdf.name, "role": "executive", "text": para}
                    )
        return len(self.chunks)

    @staticmethod
    def _tokens(text: str) -> set[str]:
        return set(re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)*", text.lower()))

    def retrieve(self, query: str, role: str = "executive", k: int = 4):
        # Role pre-filter BEFORE ranking: executive-tagged chunks are dropped
        # entirely for drivers.
        if role == "driver":
            pool = [c for c in self.chunks if c.get("role") != "executive"]
        else:
            pool = list(self.chunks)
        if not pool:
            return []
        q_tokens = self._tokens(query)
        scored = []
        for c in pool:
            overlap = len(q_tokens & self._tokens(c["text"]))
            if overlap:
                scored.append((overlap, c))
        scored.sort(key=lambda x: -x[0])
        return [
            {"source": c["source"], "snippet": c["text"][:320]}
            for _, c in scored[:k]
        ]
