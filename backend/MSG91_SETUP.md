# MSG91 SMS Gateway Integration Guide

## Overview

This application uses MSG91 for OTP delivery via SMS. MSG91 is a leading cloud communication platform in India with DLT (Distributed Ledger Technology) compliance for TRAI regulations.

## Prerequisites

1. **MSG91 Account**: Sign up at [https://msg91.com/](https://msg91.com/)
2. **DLT Registration**: Complete DLT registration for SMS templates (mandatory in India)
3. **Credits**: Purchase SMS credits in your MSG91 account

## Setup Steps

### 1. Create MSG91 Account

1. Visit [https://msg91.com/signup](https://msg91.com/signup)
2. Complete registration with your business details
3. Verify your email and mobile number
4. Complete KYC verification (required for production use)

### 2. Get Authentication Key

1. Login to MSG91 dashboard
2. Navigate to **Settings** → **API Keys**
3. Copy your **Auth Key** (looks like: `123456ABCDabcd1234567890`)
4. Keep this secure - it's your API authentication token

### 3. Register DLT Template (India Only)

For India-based SMS, you must register your OTP template with DLT:

1. Go to **DLT** section in MSG91 dashboard
2. Click **Add Template**
3. Use this template format:
   ```
   Your OTP code is {#var#}. Valid for 3 minutes. Do not share this code.
   ```
4. Submit for approval (takes 24-48 hours)
5. Once approved, copy the **Template ID**

### 4. Configure Sender ID

1. Navigate to **Sender ID** section
2. Request a sender ID (e.g., `MSGIND`, `OTPSMS`)
3. Wait for approval (takes 1-2 business days)
4. Use approved sender ID in configuration

### 5. Update Environment Variables

Add these to your `.env` file:

```bash
# MSG91 SMS Gateway Configuration
MSG91_AUTH_KEY=your-actual-auth-key-here
MSG91_SENDER_ID=MSGIND
MSG91_ROUTE=4
MSG91_DLT_TEMPLATE_ID=your-dlt-template-id-here
```

**Configuration Parameters:**

- **MSG91_AUTH_KEY**: Your authentication key from MSG91 dashboard
- **MSG91_SENDER_ID**: Approved sender ID (6 characters, alphanumeric)
- **MSG91_ROUTE**: 
  - `4` = Transactional route (recommended for OTP)
  - `1` = Promotional route
- **MSG91_DLT_TEMPLATE_ID**: Your approved DLT template ID

## API Endpoints Used

### OTP API (Current Implementation)

**Endpoint:** `https://api.msg91.com/api/v5/otp`

**Request:**
```json
{
  "template_id": "your-dlt-template-id",
  "mobile": "919876543210",
  "authkey": "your-auth-key",
  "otp": "123456",
  "otp_expiry": 3
}
```

**Response (Success):**
```json
{
  "type": "success",
  "message": "OTP sent successfully"
}
```

### Alternative: Flow API (Recommended)

For more control over message content:

**Endpoint:** `https://api.msg91.com/api/v5/flow/`

**Request:**
```json
{
  "flow_id": "your-flow-id",
  "sender": "MSGIND",
  "mobiles": "919876543210",
  "OTP": "123456",
  "VAR1": "3"
}
```

## Testing

### Development Mode

If `MSG91_AUTH_KEY` is not set, the system will:
- Print OTP to console logs
- Return success without sending SMS
- Allow testing without MSG91 account

### Production Testing

1. **Test with your own number first:**
   ```bash
   curl -X POST http://localhost:8000/api/v1/otp/request \
     -H "Content-Type: application/json" \
     -d '{
       "session_token": "your-session-token",
       "mobile_number": "9876543210"
     }'
   ```

2. **Check MSG91 logs:**
   - Login to MSG91 dashboard
   - Navigate to **Reports** → **SMS Logs**
   - Verify delivery status

3. **Monitor credits:**
   - Check remaining SMS credits in dashboard
   - Set up low-balance alerts

## Error Handling

### Common Errors

| Error Code | Description | Solution |
|------------|-------------|----------|
| 401 | Invalid auth key | Check `MSG91_AUTH_KEY` in `.env` |
| 400 | Bad request | Verify template ID and mobile format |
| 402 | Insufficient credits | Recharge your MSG91 account |
| 403 | IP not whitelisted | Add server IP in MSG91 dashboard |

### Application Behavior

- **SMS fails**: OTP is still saved in database
- **User can retry**: Request OTP again if not received
- **Logs**: All MSG91 responses logged to console
- **Fallback**: System continues to work (OTP in DB)

## Rate Limits

MSG91 rate limits (default):
- **100 SMS/second** per account
- **10,000 SMS/day** (varies by plan)

Our implementation:
- No client-side rate limiting (handled by MSG91)
- Consider adding rate limiting at API gateway level
- Monitor usage in MSG91 dashboard

## Security Best Practices

1. **Never commit `.env` file** to version control
2. **Rotate auth keys** periodically (every 90 days)
3. **Use IP whitelisting** in MSG91 dashboard
4. **Monitor unusual activity** in SMS logs
5. **Set spending limits** in MSG91 account
6. **Use HTTPS only** for API calls (enforced by MSG91)

## Cost Estimation

MSG91 Pricing (approximate):
- **Transactional SMS**: ₹0.15 - ₹0.25 per SMS
- **OTP SMS**: ₹0.18 - ₹0.22 per SMS
- **Bulk discounts**: Available for high volume

Example calculation:
- 10,000 OTPs/month × ₹0.20 = ₹2,000/month
- 1,00,000 OTPs/month × ₹0.18 = ₹18,000/month

## Monitoring & Alerts

### Set up alerts for:

1. **Low balance**: Alert when credits < 1000
2. **Failed deliveries**: Alert if failure rate > 5%
3. **High usage**: Alert on unusual spike
4. **DLT issues**: Alert on template rejections

### MSG91 Dashboard Metrics:

- Total SMS sent
- Delivery rate
- Failure reasons
- Credit balance
- Peak usage times

## Troubleshooting

### OTP not received?

1. **Check mobile number format:**
   - Must be 10 digits for India
   - No country code prefix in some cases
   - Try with/without `91` prefix

2. **Verify DLT template:**
   - Template must be approved
   - Template ID must match exactly
   - Variables must match template format

3. **Check sender ID:**
   - Must be approved by telecom operator
   - Some operators block certain sender IDs
   - Try default sender ID first

4. **Review MSG91 logs:**
   - Check delivery status
   - Look for rejection reasons
   - Verify mobile operator

### Development Tips

```python
# Enable debug logging
import logging
logging.basicConfig(level=logging.DEBUG)

# Test MSG91 connection
async def test_msg91():
    service = AppointmentService()
    result = await service._send_otp_sms("9876543210", "123456")
    print(f"SMS sent: {result}")
```

## Alternative: Flow API Implementation

To use Flow API instead of OTP API, uncomment this code in `appointment_service.py`:

```python
# Use MSG91 Flow API (recommended for DLT compliance)
flow_url = f"https://api.msg91.com/api/v5/flow/"
flow_payload = {
    "flow_id": settings.MSG91_DLT_TEMPLATE_ID,
    "sender": settings.MSG91_SENDER_ID,
    "mobiles": mobile_number,
    "OTP": otp_code,
    "VAR1": str(self.OTP_EXPIRY_MINUTES)
}

response = await client.post(
    flow_url,
    json=flow_payload,
    headers=headers
)
```

## Support

- **MSG91 Documentation**: [https://docs.msg91.com/](https://docs.msg91.com/)
- **MSG91 Support**: [support@msg91.com](mailto:support@msg91.com)
- **MSG91 Status Page**: [https://status.msg91.com/](https://status.msg91.com/)
- **Community Forum**: [https://community.msg91.com/](https://community.msg91.com/)

## Compliance

### TRAI DLT Compliance (India)

- All commercial SMS must be registered with DLT
- Template approval required before sending
- Sender ID must be approved
- Content must match registered template
- Penalties for non-compliance

### GDPR Compliance

- Store only hashed OTP codes
- Delete OTP records after expiry
- User consent for SMS communication
- Right to opt-out

## Production Checklist

- [ ] MSG91 account created and verified
- [ ] KYC completed
- [ ] Auth key generated and secured
- [ ] DLT template registered and approved
- [ ] Sender ID approved
- [ ] Environment variables configured
- [ ] Test OTP sent successfully
- [ ] SMS credits purchased
- [ ] Monitoring alerts configured
- [ ] IP whitelisting enabled (optional)
- [ ] Rate limiting configured
- [ ] Backup SMS provider configured (optional)

## Next Steps

1. Complete MSG91 account setup
2. Update `.env` with actual credentials
3. Test OTP flow end-to-end
4. Monitor first 100 OTPs closely
5. Set up production monitoring
6. Configure backup provider (optional)

---

**Last Updated:** June 2026  
**Integration Version:** 1.0  
**MSG91 API Version:** v5
