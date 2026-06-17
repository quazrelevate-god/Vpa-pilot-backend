import { useState, type FormEvent } from "react";
import { Modal } from "../shared/components/Modal";
import { useToast } from "../shared/components/Toast";
import { Icon } from "../shared/components/Icon";
import { api } from "../api/client";
import type { Slot } from "../shared/types";

function formatBlock(startTime: string): string {
  const [h, m] = startTime.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function prettyDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

interface BookAppointmentModalProps {
  slot: Slot | null;
  onClose: () => void;
  onBooked: () => void;
}

interface FormErrors {
  citizenName?: string;
  citizenPhone?: string;
  grievanceText?: string;
}

export function BookAppointmentModal({
  slot,
  onClose,
  onBooked,
}: BookAppointmentModalProps) {
  const { notify } = useToast();
  const [citizenName, setCitizenName] = useState("");
  const [citizenPhone, setCitizenPhone] = useState("");
  const [grievanceText, setGrievanceText] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const validate = (): FormErrors => {
    const e: FormErrors = {};
    if (citizenName.trim().length < 2)
      e.citizenName = "Please enter the citizen's full name.";
    const digits = citizenPhone.replace(/\D/g, "");
    if (digits.length < 10)
      e.citizenPhone = "Enter a valid phone number (at least 10 digits).";
    if (grievanceText.trim().length < 10)
      e.grievanceText = "Briefly describe the grievance (at least 10 characters).";
    return e;
  };

  const handleSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!slot) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      await api.bookAppointment({
        slotId: slot.id,
        citizenName: citizenName.trim(),
        citizenPhone: citizenPhone.trim(),
        grievanceText: grievanceText.trim(),
      });
      notify(
        `Appointment booked for ${citizenName.trim()} at ${formatBlock(
          slot.startTime
        )}.`,
        "success"
      );
      onBooked();
    } catch (err) {
      notify(
        err instanceof Error ? err.message : "Couldn't book the appointment.",
        "error"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const free = slot ? slot.capacity - slot.bookedCount : 0;

  return (
    <Modal open={!!slot} title="Book an appointment" onClose={onClose}>
      {slot && (
        <form className="form" onSubmit={handleSubmit} noValidate>
          <div className="slot-summary">
            <div className="slot-summary__when">
              <span className="slot-summary__icon">
                <Icon name="calendar" size={18} />
              </span>
              <div>
                <span className="slot-summary__label">Appointment</span>
                <span className="slot-summary__value">
                  {prettyDate(slot.date)} · {formatBlock(slot.startTime)}
                </span>
              </div>
            </div>
            <span className="slot-chip slot-chip--ok">{free} left</span>
          </div>

          <label className="field">
            <span className="field__label">
              Citizen's name <span className="field__req">*</span>
            </span>
            <div className="field__input-wrap">
              <span className="field__input-icon">
                <Icon name="user" size={16} />
              </span>
              <input
                className={`field__input field__input--has-icon${
                  errors.citizenName ? " field__input--error" : ""
                }`}
                type="text"
                value={citizenName}
                onChange={(e) => setCitizenName(e.target.value)}
                placeholder="e.g. Lakshmi Narayanan"
                autoFocus
              />
            </div>
            {errors.citizenName && (
              <span className="field__error">
                <Icon name="alert" size={13} /> {errors.citizenName}
              </span>
            )}
          </label>

          <label className="field">
            <span className="field__label">
              Phone number <span className="field__req">*</span>
            </span>
            <div className="field__input-wrap">
              <span className="field__input-icon">
                <Icon name="phone" size={15} />
              </span>
              <input
                className={`field__input field__input--has-icon${
                  errors.citizenPhone ? " field__input--error" : ""
                }`}
                type="tel"
                value={citizenPhone}
                onChange={(e) => setCitizenPhone(e.target.value)}
                placeholder="e.g. 98765 43210"
                inputMode="tel"
              />
            </div>
            <span className="field__hint">
              <Icon name="info" size={13} /> Used to send SMS / WhatsApp status updates.
            </span>
            {errors.citizenPhone && (
              <span className="field__error">
                <Icon name="alert" size={13} /> {errors.citizenPhone}
              </span>
            )}
          </label>

          <label className="field">
            <span className="field__label">
              What is the grievance? <span className="field__req">*</span>
            </span>
            <textarea
              className={`field__input field__textarea${
                errors.grievanceText ? " field__input--error" : ""
              }`}
              value={grievanceText}
              onChange={(e) => setGrievanceText(e.target.value)}
              placeholder="Describe the issue in a sentence or two. An AI summary will be generated for the office to review."
              rows={4}
            />
            {errors.grievanceText && (
              <span className="field__error">
                <Icon name="alert" size={13} /> {errors.grievanceText}
              </span>
            )}
          </label>

          <div className="form__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? (
                "Booking…"
              ) : (
                <>
                  <Icon name="check" size={16} /> Confirm booking
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
