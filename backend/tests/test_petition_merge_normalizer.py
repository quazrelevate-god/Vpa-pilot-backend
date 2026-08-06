"""Unit tests for the petition-merge normalizer + similarity — pure Python,
no DB. Guards the Find-similar detector against silent regressions:
identical asks must score 1.0, near-paraphrases must land above the 0.5
threshold, unrelated demands must fall below it."""
from __future__ import annotations

from src.services.petition_merge_service import (
    _similarity, ask_hash, normalize_ask,
)


class TestNormalizeAsk:
    def test_strips_common_greetings(self):
        a = normalize_ask("Respected Sir, Kindly repair the road in our street.")
        b = normalize_ask("Sir, please repair the road in our street")
        assert a == b == "repair the road in our street"

    def test_lowercases_and_squashes_whitespace(self):
        assert normalize_ask("REPAIR THE  ROAD.") == "repair the road"

    def test_preserves_tamil(self):
        # Tamil characters must survive; the punctuation strip class allows Tamil.
        norm = normalize_ask("இந்த சாலை பழுதுபடுத்தவும்.")
        assert "இந்த" in norm and "சாலை" in norm

    def test_empty(self):
        assert normalize_ask("") == ""
        assert normalize_ask(None) == ""

    def test_hash_stable_across_greetings(self):
        assert ask_hash("Sir, please repair the road") == ask_hash("please repair the road")


class TestSimilarity:
    def test_identical_scores_one(self):
        s = _similarity(*[normalize_ask("Repair the road")] * 2)
        assert s == 1.0

    def test_disjoint_scores_low(self):
        s = _similarity(
            normalize_ask("Reinstate pension arrears for 3,000 retired teachers"),
            normalize_ask("Waive power tariff arrears for 4,000 handloom units"),
        )
        assert s < 0.3

    def test_paraphrase_stays_above_threshold(self):
        # Same demand, reordered — must clear the 0.50 default threshold used
        # by find_similar so real duplicates aren't lost.
        a = normalize_ask("Repair the road in Anna Nagar 4th street")
        b = normalize_ask("The road in Anna Nagar 4th street is damaged, please repair")
        assert _similarity(a, b) >= 0.50

    def test_empty_sides_return_zero(self):
        assert _similarity("", "repair the road") == 0.0
        assert _similarity("repair the road", "") == 0.0
