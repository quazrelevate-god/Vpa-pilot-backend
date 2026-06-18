# Form Validation Documentation

## Overview

Comprehensive validation implemented on both frontend (client-side) and backend (server-side) to ensure data integrity and security.

---

## Required Fields

### Mandatory Fields for OTP Request:
1. **Name** - Full name of citizen
2. **Mobile Number** - 10-digit Indian mobile number
3. **Description OR Files** - Either text description or file attachments (at least one required)

### Mandatory Fields for Form Submission:
1. **Name** - Full name of citizen
2. **Mobile Number** - 10-digit Indian mobile number  
3. **OTP Code** - 6-digit OTP received via SMS
4. **Description OR Files** - Either text description or file attachments (at least one required)

---

## Frontend Validation (Client-Side)

### 1. Real-time Field Validation

**OTP Button State Management:**
```javascript
function validateFormForOTP() {
    const name = document.getElementById('txtName').value.trim();
    const mobile = document.getElementById('txtMobile').value.trim();
    const description = document.getElementById('txtDesc').value.trim();
    const hasFiles = registeredFileList.filter(f => f !== null).length > 0;
    
    // All fields must be filled: name, mobile, and (description OR files)
    const isValid = name && mobile && (description || hasFiles);
    
    // Enable/disable OTP button based on validation
    document.getElementById('btnGenOtp').disabled = !isValid;
    
    return isValid;
}
```

**Validation Triggers:**
- Name field input
- Mobile field input
- Description field input
- File upload/removal

**Initial State:**
- OTP button is **disabled** on page load
- Enabled only when all required fields are filled

### 2. Mobile Number Validation

**Format:** Indian mobile number (10 digits starting with 6-9)

```javascript
if (!/^[6-9][0-9]{9}$/.test(phoneField.value)) {
    errorElement.innerText = 'Invalid 10-digit number';
    errorElement.style.display = 'block';
    return;
}
```

**Validation Points:**
- Before OTP request
- Real-time input filtering (only digits allowed)

### 3. OTP Validation

**Format:** 6-digit numeric code

```javascript
if (otpVal.length !== 6) {
    errorElement.innerText = 'Invalid 6-digit OTP';
    errorElement.style.display = 'block';
    return;
}
```

**Validation Points:**
- Before OTP verification
- Real-time input filtering (only digits allowed)
- Maximum length: 6 characters

### 4. File Upload Validation

**Constraints:**
- Maximum file size: 5MB per file
- Supported formats: CSV, PDF, JPG, PNG, DOC, DOCX
- Multiple files allowed

```javascript
if(file.size > 5 * 1024 * 1024) {
    // File rejected - too large
    return;
}
```

### 5. Form Submission Validation

**Pre-submission Checks:**
```javascript
// 1. OTP must be verified
if (!isSystemPhoneVerified) {
    alert('Please verify your OTP before submitting.');
    return;
}

// 2. Session token must exist
if (!sessionToken) {
    alert('Session token not found. Please scan QR code again.');
    return;
}

// 3. All required fields must be filled
if (!name || !mobile || !otp || (!description && !hasFiles)) {
    alert('Please fill in all required fields: Name, Mobile, OTP, and either Description or upload files.');
    return;
}
```

---

## Backend Validation (Server-Side)

### 1. OTP Request Endpoint (`/api/v1/otp/request`)

**Validations:**
```python
# Session token validation
- Token must exist in database
- Token must not be expired
- Token must not be used

# Mobile number validation
- Must be digits only
- Length validation (10-15 digits)
```

**Rate Limiting:**
- **3 requests per minute** per IP address
- Prevents OTP spam

### 2. Appointment Submission Endpoint (`/api/v1/appointments/submit`)

**Field Validations:**

```python
# Name validation
name: str = Form(..., min_length=1, max_length=100)

# Mobile number validation
mobile_number: str = Form(..., min_length=10, max_length=15)
if not mobile_number.isdigit():
    raise HTTPException(400, "Mobile number must contain only digits")

# OTP validation
otp_code: str = Form(..., min_length=6, max_length=6)
if not otp_code.isdigit():
    raise HTTPException(400, "OTP code must be 6 digits")

# Description OR Files validation
has_description = description and description.strip()
has_files = files and len(files) > 0 and any(f.filename for f in files)

if not has_description and not has_files:
    raise HTTPException(400, "Either description or file attachments must be provided")
```

**Rate Limiting:**
- **5 requests per minute** per IP address
- Prevents submission spam

**Security Validations:**
- Session token must be valid and active
- OTP must match and not be expired
- Maximum 3 OTP verification attempts
- Device fingerprint must match
- Brute-force protection enabled

---

## Validation Flow Diagram

```
User Opens Form
    ↓
[Name, Mobile, Description/Files fields empty]
    ↓
OTP Button: DISABLED ❌
    ↓
User fills Name
    ↓
Validation runs → Still incomplete
    ↓
OTP Button: DISABLED ❌
    ↓
User fills Mobile
    ↓
Validation runs → Still incomplete
    ↓
OTP Button: DISABLED ❌
    ↓
User fills Description OR uploads file
    ↓
Validation runs → All required fields filled ✓
    ↓
OTP Button: ENABLED ✅
    ↓
User clicks "Send OTP"
    ↓
Frontend validates mobile format
    ↓
API call to /api/v1/otp/request
    ↓
Backend validates session + mobile
    ↓
OTP sent via MSG91
    ↓
OTP input field appears
    ↓
User enters OTP
    ↓
OTP verified
    ↓
Submit button: ENABLED ✅
    ↓
User clicks "Submit"
    ↓
Frontend validates all fields
    ↓
API call to /api/v1/appointments/submit
    ↓
Backend validates:
  - Session token
  - Name (1-100 chars)
  - Mobile (10-15 digits)
  - OTP (6 digits, not expired, max 3 attempts)
  - Description OR Files (at least one)
    ↓
Atomic transaction:
  - Verify OTP
  - Create citizen record
  - Create appointment
  - Save file attachments
    ↓
Success! Token number assigned
```

---

## Error Messages

### Frontend Error Messages

| Validation | Error Message |
|------------|---------------|
| Empty required fields | "Please fill in Name, Mobile Number, and either Description or upload files before requesting OTP." |
| Invalid mobile format | "Invalid 10-digit number" |
| Invalid OTP format | "Invalid 6-digit OTP" |
| OTP not verified | "Please verify your OTP before submitting." |
| Missing session token | "Session token not found. Please scan QR code again." |
| Incomplete submission | "Please fill in all required fields: Name, Mobile, OTP, and either Description or upload files." |

### Backend Error Messages

| Validation | HTTP Code | Error Message |
|------------|-----------|---------------|
| Invalid mobile format | 400 | "Mobile number must contain only digits" |
| Invalid OTP format | 400 | "OTP code must be 6 digits" |
| Missing description/files | 400 | "Either description or file attachments must be provided" |
| Invalid session | 404 | "Session token not found" |
| Expired session | 400 | "Session token has expired" |
| Invalid OTP | 400 | "Invalid or expired OTP" |
| OTP attempts exceeded | 400 | "Maximum OTP verification attempts exceeded" |
| Rate limit exceeded | 429 | "Too many requests" |

---

## Testing Checklist

### Frontend Validation Tests

- [ ] OTP button disabled on page load
- [ ] OTP button remains disabled with only name filled
- [ ] OTP button remains disabled with only mobile filled
- [ ] OTP button remains disabled with only description filled
- [ ] OTP button remains disabled with only file uploaded
- [ ] OTP button enabled when name + mobile + description filled
- [ ] OTP button enabled when name + mobile + file uploaded
- [ ] OTP button disabled when file removed and no description
- [ ] Mobile number accepts only digits
- [ ] Mobile number validates 10-digit format
- [ ] OTP field accepts only digits
- [ ] OTP field validates 6-digit format
- [ ] Submit button disabled until OTP verified
- [ ] Form submission validates all required fields

### Backend Validation Tests

- [ ] OTP request rejected with invalid session token
- [ ] OTP request rejected with expired session token
- [ ] OTP request rejected with non-digit mobile number
- [ ] Appointment submission rejected without description or files
- [ ] Appointment submission rejected with invalid OTP
- [ ] Appointment submission rejected with expired OTP
- [ ] Appointment submission rejected after 3 failed OTP attempts
- [ ] Rate limiting works (3 OTP requests/min)
- [ ] Rate limiting works (5 submissions/min)

---

## Security Features

### Client-Side Security
1. **Input Sanitization** - Only digits allowed for mobile/OTP
2. **Real-time Validation** - Prevents invalid data entry
3. **File Size Limits** - Max 5MB per file
4. **Session Token Binding** - Form bound to QR scan session

### Server-Side Security
1. **Rate Limiting** - Prevents spam and DoS attacks
2. **OTP Hashing** - SHA-256 hashing before storage
3. **Brute-Force Protection** - Max 3 OTP attempts
4. **Single-Use OTP** - Marked as used after verification
5. **Session Validation** - Token must be active and not expired
6. **Device Fingerprinting** - Prevents URL sharing
7. **Field Encryption** - PII data encrypted (placeholder)
8. **Atomic Transactions** - All-or-nothing database operations

---

## API Integration

### OTP Request
```javascript
const response = await fetch('/api/v1/otp/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        session_token: sessionToken,
        mobile_number: phoneField.value
    })
});
```

### Form Submission
```javascript
const formData = new FormData();
formData.append('session_token', sessionToken);
formData.append('name', name);
formData.append('mobile_number', mobile);
formData.append('constituency', 'Namakkal');
formData.append('description', description || 'See attachments');
formData.append('otp_code', otp);
formData.append('schedule_meeting', 'false');

// Add files
registeredFileList.filter(f => f !== null).forEach(file => {
    formData.append('files', file);
});

const response = await fetch('/api/v1/appointments/submit', {
    method: 'POST',
    body: formData
});
```

---

## Best Practices Implemented

1. ✅ **Progressive Enhancement** - Form works with JavaScript, validates on both sides
2. ✅ **User Feedback** - Clear error messages and loading states
3. ✅ **Accessibility** - Required field indicators, error messages
4. ✅ **Performance** - Real-time validation without excessive API calls
5. ✅ **Security** - Multi-layer validation and rate limiting
6. ✅ **UX** - Disabled states prevent invalid submissions
7. ✅ **Error Handling** - Graceful degradation with network errors

---

## Future Enhancements

1. **Input Sanitization** - Add bleach library for HTML sanitization
2. **CSRF Protection** - Add CSRF tokens to form
3. **File Content Validation** - Magic number validation for file types
4. **Duplicate Prevention** - Check for duplicate submissions
5. **Enhanced Rate Limiting** - Per-user rate limiting
6. **Captcha Integration** - Add captcha for bot prevention

---

**Last Updated:** June 18, 2026  
**Version:** 1.0  
**Status:** ✅ Production Ready (with noted enhancements)
