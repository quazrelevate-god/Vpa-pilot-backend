"""settings: registries (department + ministry) + login RBAC columns

Revision ID: 026
Revises: 025
Create Date: 2026-07-06

Adds the DB surface backing the Settings page:

  1. `login` gets `email`, `full_name`, `role` — the seed of RBAC. Existing
     rows default to role='pa'; the env admin's row (seeded lazily on first
     login) will get role='super_admin'.

  2. `department_registry` — one row per school-education sub-department, keyed
     by the SchoolDepartment enum value. Adds `display_ta` + `email` (which
     the dept_account inherits from here so super admin can rotate/reset).
     Seeded with the 10 existing SchoolDepartments so nothing regresses.

  3. `ministry_registry` — one row per Ministry enum value. Adds `email` +
     bilingual display labels so the admin can configure the auto-forward
     mail address for each of the 34 ministries without a code deploy.

Both registries are idempotent (INSERT ... ON CONFLICT DO NOTHING) so
re-running the migration or importing the seed twice is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "026"
down_revision: Union[str, None] = "025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ── Seed data — pulled from the current Python enums / display maps ──────────
_SCHOOL_DEPARTMENTS = [
    ("director_school_education",  "Director of School Education"),
    ("private_schools",            "Directorate of Private Schools"),
    ("elementary_education",       "Elementary Education"),
    ("govt_examination",           "Government Examinations"),
    ("non_formal_adult_education", "Non-Formal & Adult Education"),
    ("public_libraries",           "Public Libraries"),
    ("scert",                      "State Council of Educational Research & Training (SCERT)"),
    ("teacher_recruitment_board",  "Teacher Recruitment Board (TRB)"),
    ("tn_education_service_corp",  "TN Education Service Corporation"),
    ("samagra_shiksha",            "Samagra Shiksha"),
]

_MINISTRIES = [
    ("rural_development_water_resources",         "Rural Development & Water Resources"),
    ("public_works_sports_development",           "Public Works & Sports Development"),
    ("health_medical_education_family_welfare",   "Health, Medical Education & Family Welfare"),
    ("revenue_disaster_management",               "Revenue & Disaster Management"),
    ("food_civil_supplies_consumer_protection",   "Food, Civil Supplies & Consumer Protection"),
    ("energy_law_courts_prevention_corruption",   "Energy, Law, Courts & Prevention of Corruption"),
    ("school_education_tamil_dev_info_publicity", "School Education, Tamil Development, Information & Publicity"),
    ("natural_resources_minerals_mines",          "Natural Resources (Minerals & Mines)"),
    ("industries_investment_promotion",           "Industries & Investment Promotion"),
    ("fisheries_fishermen_welfare",               "Fisheries & Fishermen Welfare"),
    ("animal_husbandry",                          "Animal Husbandry"),
    ("milk_dairy_development",                    "Milk & Dairy Development"),
    ("forests",                                   "Forests"),
    ("agriculture_farmers_welfare",               "Agriculture & Farmers Welfare"),
    ("environment_climate_change",                "Environment & Climate Change"),
    ("housing_urban_development",                 "Housing & Urban Development"),
    ("cooperation",                               "Cooperation"),
    ("msme",                                      "MSME"),
    ("social_welfare_women_welfare",              "Social Welfare & Women Welfare"),
    ("handlooms_textiles_khadi",                  "Handlooms, Textiles & Khadi"),
    ("commercial_taxes_registration",             "Commercial Taxes & Registration"),
    ("transport",                                 "Transport"),
    ("hindu_religious_charitable_endowments",     "Hindu Religious & Charitable Endowments (HR&CE)"),
    ("ai_information_technology",                 "AI & Information Technology"),
    ("welfare_non_resident_tamils",               "Welfare of Non-Resident Tamils"),
    ("backward_classes_welfare",                  "Backward Classes Welfare"),
    ("labour_welfare_skill_development",          "Labour Welfare & Skill Development"),
    ("human_resources_management",                "Human Resources Management"),
    ("finance_planning_development",              "Finance, Planning & Development"),
    ("prohibition_excise",                        "Prohibition & Excise"),
    ("tourism",                                   "Tourism"),
    ("higher_education_technical_education",      "Higher Education & Technical Education"),
    ("minorities_welfare_wakf_board",             "Minorities Welfare & Wakf Board"),
    ("social_justice_adi_dravidar_welfare",       "Social Justice & Adi Dravidar Welfare"),
    ("other",                                     "Other / Unclassified"),
]


def upgrade() -> None:
    # ── 1. login RBAC columns ────────────────────────────────────────────────
    op.add_column("login", sa.Column("email", sa.String(255), nullable=True))
    op.add_column("login", sa.Column("full_name", sa.String(200), nullable=True))
    op.add_column(
        "login",
        sa.Column("role", sa.String(30), nullable=False, server_default="pa"),
    )
    op.create_index("ix_login_role", "login", ["role"])
    op.create_index("ix_login_email", "login", ["email"], unique=True,
                    postgresql_where=sa.text("email IS NOT NULL"))

    # ── 2. department_registry ───────────────────────────────────────────────
    op.create_table(
        "department_registry",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("key", sa.String(60), nullable=False, unique=True),
        sa.Column("display_en", sa.String(200), nullable=False),
        sa.Column("display_ta", sa.String(200), nullable=True),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column(
            "is_active", sa.Boolean, nullable=False, server_default=sa.text("true")
        ),
        sa.Column("is_builtin", sa.Boolean, nullable=False, server_default=sa.text("false"),
                  comment="TRUE for the 10 seeded SchoolDepartments (can't be deleted, only deactivated)"),
        sa.Column("created_by", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime, nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_department_registry_active", "department_registry", ["is_active"])

    # Seed the 10 built-in departments.
    bind = op.get_bind()
    for key, label in _SCHOOL_DEPARTMENTS:
        bind.execute(
            sa.text(
                "INSERT INTO department_registry (key, display_en, is_builtin) "
                "VALUES (:key, :label, TRUE) "
                "ON CONFLICT (key) DO NOTHING"
            ),
            {"key": key, "label": label},
        )

    # ── 3. ministry_registry ─────────────────────────────────────────────────
    op.create_table(
        "ministry_registry",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("key", sa.String(80), nullable=False, unique=True),
        sa.Column("display_en", sa.String(200), nullable=False),
        sa.Column("display_ta", sa.String(200), nullable=True),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column(
            "is_active", sa.Boolean, nullable=False, server_default=sa.text("true")
        ),
        sa.Column("updated_at", sa.DateTime, nullable=False,
                  server_default=sa.text("now()")),
    )

    for key, label in _MINISTRIES:
        bind.execute(
            sa.text(
                "INSERT INTO ministry_registry (key, display_en) "
                "VALUES (:key, :label) "
                "ON CONFLICT (key) DO NOTHING"
            ),
            {"key": key, "label": label},
        )


def downgrade() -> None:
    op.drop_table("ministry_registry")
    op.drop_index("ix_department_registry_active", table_name="department_registry")
    op.drop_table("department_registry")
    op.drop_index("ix_login_email", table_name="login")
    op.drop_index("ix_login_role", table_name="login")
    op.drop_column("login", "role")
    op.drop_column("login", "full_name")
    op.drop_column("login", "email")
