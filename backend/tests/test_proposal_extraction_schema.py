"""Unit tests for the ProposalExtraction Pydantic contract.

The schema is the shared vocabulary between Gemini (structured output) and
every downstream consumer (extraction_json in the DB, the review UI, the
dashboard). Old rows in the DB were written before the v2 fields existed;
they MUST still parse cleanly through the extended schema — otherwise a
schema evolution would silently break the review UI for every historical
proposal.

These tests are pure (no DB, no Gemini). They guard three properties:
  1. every extractor / caller receives sane defaults for the v2 fields;
  2. the old on-disk shape parses without loss;
  3. bilingual pair lengths stay independent (an EN-only extraction is valid).
"""
from __future__ import annotations

from src.models.proposal_extraction import ProposalExtraction, ProposalRecommendation


def _old_shape_valid_minimum() -> dict:
    """A row as it would have been written before v2 field additions."""
    return {
        "title": "Test", "title_ta": "சோதனை",
        "problem_statement": "The gap", "problem_statement_ta": "",
        "proposed_solution": "The pitch", "proposed_solution_ta": "",
        "expected_benefit": "The upside", "expected_benefit_ta": "",
        "beneficiary_scope": "12,000 students", "beneficiary_scope_ta": "",
        "estimated_cost": "Rs 5 lakh",
        "timeline": "3 months",
        "key_highlights": [], "key_highlights_ta": [],
        "ai_recommendation": "standard",
        "ai_rationale": "",
        "document_date": None,
    }


class TestOldShapeParses:
    def test_pre_v2_rows_parse_cleanly(self):
        p = ProposalExtraction.model_validate(_old_shape_valid_minimum())
        assert p.title == "Test"
        assert p.ai_recommendation is ProposalRecommendation.STANDARD

    def test_new_field_defaults_are_safe(self):
        p = ProposalExtraction.model_validate(_old_shape_valid_minimum())
        # Every new field must default to an "empty" value so the UI's
        # specified() guard hides it, not a placeholder.
        assert p.key_risks == []
        assert p.key_risks_ta == []
        assert p.implementation_readiness == ""
        assert p.implementation_readiness_ta == ""
        assert p.applicant_contribution == "Not specified"
        assert p.partnership_model == ""
        assert p.partnership_model_ta == ""
        assert p.track_record == ""
        assert p.track_record_ta == ""


class TestNewShapeParses:
    def test_full_v2_row_roundtrips(self):
        data = {**_old_shape_valid_minimum(),
                "key_risks": ["Dependency on Central grant", "Untested at scale"],
                "key_risks_ta": ["மத்திய நிதி நிலுவை", "பெரிய அளவில் சோதிக்கப்படவில்லை"],
                "implementation_readiness": "Pilot in 3 wards for 6 months.",
                "implementation_readiness_ta": "3 வார்டுகளில் 6 மாதம்.",
                "applicant_contribution": "INR 1 crore + engineering team",
                "partnership_model": "PPP with L&T",
                "partnership_model_ta": "L&T உடன் பொது-தனியார்",
                "track_record": "40 Kerala panchayats since 2023.",
                "track_record_ta": "2023 முதல் 40 கேரள ஊராட்சிகள்."}
        p = ProposalExtraction.model_validate(data)
        assert len(p.key_risks) == 2
        assert p.applicant_contribution.startswith("INR 1")
        # Idempotence: dump → validate returns an equal object.
        again = ProposalExtraction.model_validate(p.model_dump())
        assert again == p

    def test_key_risks_can_be_uneven_bilingual(self):
        # The prompt asks for aligned pairs, but Gemini occasionally emits
        # unequal lengths under load. The schema does NOT enforce alignment,
        # so partial-Tamil should still validate rather than 500 the pipeline.
        data = {**_old_shape_valid_minimum(),
                "key_risks": ["A", "B"], "key_risks_ta": ["A-ta"]}
        p = ProposalExtraction.model_validate(data)
        assert len(p.key_risks) == 2 and len(p.key_risks_ta) == 1


class TestEnumTolerance:
    def test_recommendation_accepts_all_three_values(self):
        for v in ("review_closely", "standard", "needs_more_info"):
            data = {**_old_shape_valid_minimum(), "ai_recommendation": v}
            p = ProposalExtraction.model_validate(data)
            assert p.ai_recommendation.value == v
