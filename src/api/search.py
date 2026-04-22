"""Lightweight in-memory search with TF scoring and term-coverage tie-break."""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import Iterable


_TOKEN_RE = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


def score(query: str, doc: str) -> float:
    q_terms = tokenize(query)
    if not q_terms:
        return 0.0
    d_tokens = tokenize(doc)
    if not d_tokens:
        return 0.0
    tf = Counter(d_tokens)
    length_norm = 1.0 / math.sqrt(len(d_tokens))
    matched = 0
    tf_sum = 0.0
    for term in set(q_terms):
        count = tf.get(term, 0)
        if count:
            matched += 1
            tf_sum += math.log1p(count)
    if matched == 0:
        return 0.0
    coverage = matched / len(set(q_terms))
    return tf_sum * length_norm * coverage


def search(query: str, docs: Iterable[str], k: int | None = None) -> list[tuple[int, float]]:
    scored = [(i, score(query, d)) for i, d in enumerate(docs)]
    scored = [(i, s) for i, s in scored if s > 0.0]
    scored.sort(key=lambda x: (-x[1], x[0]))
    return scored if k is None else scored[:k]
