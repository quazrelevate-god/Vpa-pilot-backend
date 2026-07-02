# Petition-summariser evaluator

Measures how well a model reads a petition and routes it — so model/prompt
changes are decided by numbers, not hunches.

## Layout
- `cases/` — the petition image files (drop your test images here)
- `cases.csv` — one row per case + the **gold** (correct) labels
- `run_eval.py` — runs cases through a model, auto-scores routing, writes results
- `score_eval.py` — aggregates results into a scorecard

## 1. Add test data
Put images in `cases/`, then one row per case in `cases.csv`:

| column | meaning |
|---|---|
| `id` | any unique id |
| `files` | image filename(s) in `cases/`; `;`-separate multi-page (`2a.jpg;2b.jpg`) |
| `language` | `tamil` / `english` / `mixed` — used only to slice the scorecard |
| `handwritten` | `yes` / `no` |
| `gold_category` | the **correct** category (picklist below) |
| `gold_department` | the **correct** department (picklist below) |
| `gold_urgency` | `low` / `medium` / `high` / `critical` |
| `notes` | free text (optional) |

Leave the summary out — you score that by hand after the run.

> **Gold labels must follow the current business rule:** if the correct
> department is NOT School Education, `gold_category` should be `other`.

## 2. Run against a model (from backend/)
```
python eval/run_eval.py --model gemini-2.5-flash
```
Writes `results_<model>_<timestamp>.csv`.

## 3. Score the summaries
Open that file, fill the `summary_score` column (1-5) for each row.

## 4. Scorecard
```
python eval/score_eval.py
```

Repeat steps 2-4 for `gemini-2.5-pro`, `gemini-3.1-pro`, etc. and compare.

## Picklists
**urgency:** low · medium · high · critical

**category:** action_required · proposals · transfer_requests · pension_requests ·
school_admission · job_requests · rti · associations_unions · school_upgradation ·
invitation · greetings · general · other

**department:** rural_development_water_resources, public_works_sports_development,
health_medical_education_family_welfare, revenue_disaster_management,
food_civil_supplies_consumer_protection, energy_law_courts_prevention_corruption,
school_education_tamil_dev_info_publicity, natural_resources_minerals_mines,
industries_investment_promotion, fisheries_fishermen_welfare, animal_husbandry,
milk_dairy_development, forests, agriculture_farmers_welfare, environment_climate_change,
housing_urban_development, cooperation, msme, social_welfare_women_welfare,
handlooms_textiles_khadi, commercial_taxes_registration, transport,
hindu_religious_charitable_endowments, ai_information_technology,
welfare_non_resident_tamils, backward_classes_welfare, labour_welfare_skill_development,
human_resources_management, finance_planning_development, prohibition_excise, tourism,
higher_education_technical_education, minorities_welfare_wakf_board,
social_justice_adi_dravidar_welfare, other
