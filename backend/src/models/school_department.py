"""
School Education departments — the sub-units a ticket is routed to.

The AI summary routes to a MINISTRY (broad, ~34 TN departments — see
grievance_summary.Department, being renamed to Ministry). Within the School
Education ministry, the PA office routes each ticket to ONE of these 10
operational departments, whose staff then accept / forward / resolve it.

A non-school ticket has no department (its ministry != school) and is
forwarded out directly.
"""
from enum import Enum


class SchoolDepartment(str, Enum):
    DIRECTOR_SCHOOL_EDUCATION  = "director_school_education"
    PRIVATE_SCHOOLS            = "private_schools"
    ELEMENTARY_EDUCATION       = "elementary_education"
    GOVT_EXAMINATION           = "govt_examination"
    NON_FORMAL_ADULT_EDUCATION = "non_formal_adult_education"
    PUBLIC_LIBRARIES           = "public_libraries"
    SCERT                      = "scert"
    TEACHER_RECRUITMENT_BOARD  = "teacher_recruitment_board"
    TN_EDUCATION_SERVICE_CORP  = "tn_education_service_corp"
    SAMAGRA_SHIKSHA            = "samagra_shiksha"


# Human-readable labels for the PA portal + department dashboard.
SCHOOL_DEPARTMENT_DISPLAY = {
    "director_school_education":  "Director of School Education",
    "private_schools":            "Directorate of Private Schools",
    "elementary_education":       "Elementary Education",
    "govt_examination":           "Government Examinations",
    "non_formal_adult_education": "Non-Formal & Adult Education",
    "public_libraries":           "Public Libraries",
    "scert":                      "State Council of Educational Research & Training (SCERT)",
    "teacher_recruitment_board":  "Teacher Recruitment Board (TRB)",
    "tn_education_service_corp":  "TN Education Service Corporation",
    "samagra_shiksha":            "Samagra Shiksha",
}


def department_label(value: str) -> str:
    return SCHOOL_DEPARTMENT_DISPLAY.get(value, value)
