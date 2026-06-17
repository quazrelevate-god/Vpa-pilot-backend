"""
FastAPI routes for citizen form submission.
Handles form display and data collection after QR verification.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime

from src.core.database import get_db
from src.core.utils import generate_device_fingerprint
from src.models.qr_models import GatekeeperSession


router = APIRouter(
    prefix="/form",
    tags=["Form Management"]
)


@router.get(
    "",
    response_class=HTMLResponse,
    summary="Display Citizen Form",
    description="Display form for citizen data collection after QR verification"
)
async def display_form(
    request: Request,
    token: str = Query(
        ...,
        description="Session token from QR verification",
        example="550e8400-e29b-41d4-a716-446655440000"
    ),
    db: AsyncSession = Depends(get_db)
) -> HTMLResponse:
    """
    Display citizen information form after successful QR verification.
    
    Process Flow:
        1. Generate device fingerprint from current request
        2. Validate session token exists in database
        3. Verify device fingerprint matches the one that created the session
        4. Check token hasn't expired
        5. Check token hasn't been used already
        6. Display HTML form for data collection
    
    Args:
        request: FastAPI Request object (for device fingerprint validation)
        token: UUID session token from gatekeeper_sessions table
        db: Injected database session from dependency
    
    Returns:
        HTMLResponse: Rendered HTML form page
    
    Raises:
        HTTPException 400: Invalid or expired token
        HTTPException 403: Token already used or device fingerprint mismatch
        HTTPException 404: Token not found
    
    Security:
        - Token must exist in gatekeeper_sessions table
        - Device fingerprint must match the one that verified the QR
        - Token must not be expired
        - Token must not be marked as used (is_used=False)
        - Prevents URL sharing across different browsers/devices
    """
    try:
        # Step 1: Generate device fingerprint from current request
        current_fingerprint = generate_device_fingerprint(request)
        
        # Step 2: Validate session token
        stmt = select(GatekeeperSession).where(
            GatekeeperSession.session_token == token
        )
        result = await db.execute(stmt)
        session = result.scalar_one_or_none()
        
        if not session:
            raise HTTPException(
                status_code=404,
                detail="Session token not found. Please scan QR code again."
            )
        
        # Step 3: Verify device fingerprint matches
        if session.device_fingerprint != current_fingerprint:
            raise HTTPException(
                status_code=403,
                detail="Security violation: This form can only be accessed from the device that scanned the QR code. Please scan the QR code again from this device."
            )
        
        # Step 4: Check if token has expired
        current_time = datetime.utcnow()
        if session.expires_at < current_time:
            raise HTTPException(
                status_code=400,
                detail="Session token has expired. Please scan QR code again."
            )
        
        # Step 5: Check if token has already been used
        if session.is_used:
            raise HTTPException(
                status_code=403,
                detail="This session has already been used. Please scan QR code again."
            )
        
        # Render HTML form
        html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Citizen Scheduler - Submit Your Query</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }}
        
        .container {{
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            max-width: 600px;
            width: 100%;
            padding: 40px;
        }}
        
        .header {{
            text-align: center;
            margin-bottom: 30px;
        }}
        
        .header h1 {{
            color: #333;
            font-size: 28px;
            margin-bottom: 8px;
        }}
        
        .header p {{
            color: #666;
            font-size: 14px;
        }}
        
        .session-info {{
            background: #f0f4ff;
            border-left: 4px solid #667eea;
            padding: 12px 16px;
            margin-bottom: 30px;
            border-radius: 4px;
        }}
        
        .session-info p {{
            color: #555;
            font-size: 13px;
            margin: 4px 0;
        }}
        
        .form-group {{
            margin-bottom: 24px;
        }}
        
        label {{
            display: block;
            color: #333;
            font-weight: 600;
            margin-bottom: 8px;
            font-size: 14px;
        }}
        
        label .required {{
            color: #e74c3c;
        }}
        
        input[type="text"],
        input[type="tel"],
        textarea,
        select {{
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 15px;
            transition: border-color 0.3s;
            font-family: inherit;
        }}
        
        input[type="text"]:focus,
        input[type="tel"]:focus,
        textarea:focus,
        select:focus {{
            outline: none;
            border-color: #667eea;
        }}
        
        textarea {{
            resize: vertical;
            min-height: 120px;
        }}
        
        .char-count {{
            text-align: right;
            color: #999;
            font-size: 12px;
            margin-top: 4px;
        }}
        
        .file-input {{
            padding: 10px;
            border: 2px dashed #e0e0e0;
            border-radius: 8px;
            cursor: pointer;
            transition: border-color 0.3s;
        }}
        
        .file-input:hover {{
            border-color: #667eea;
        }}
        
        .file-input:focus {{
            outline: none;
            border-color: #667eea;
            border-style: solid;
        }}
        
        .file-info {{
            color: #999;
            font-size: 12px;
            margin-top: 6px;
        }}
        
        .submit-btn {{
            width: 100%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 16px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }}
        
        .submit-btn:hover {{
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
        }}
        
        .submit-btn:active {{
            transform: translateY(0);
        }}
        
        .submit-btn:disabled {{
            background: #ccc;
            cursor: not-allowed;
            transform: none;
        }}
        
        .error {{
            color: #e74c3c;
            font-size: 13px;
            margin-top: 4px;
            display: none;
        }}
        
        .error.show {{
            display: block;
        }}
        
        @media (max-width: 640px) {{
            .container {{
                padding: 24px;
            }}
            
            .header h1 {{
                font-size: 24px;
            }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📋 Citizen Query Form</h1>
            <p>Please fill in your details to submit your query</p>
        </div>
        
        <div class="session-info">
            <p><strong>⏰ Valid Until:</strong> {session.expires_at.strftime('%I:%M %p')}</p>
        </div>
        
        <form id="citizenForm" method="POST" action="/api/v1/form/submit">
            <input type="hidden" name="token" value="{token}">
            
            <div class="form-group">
                <label for="name">
                    Full Name <span class="required">*</span>
                </label>
                <input 
                    type="text" 
                    id="name" 
                    name="name" 
                    required 
                    placeholder="Enter your full name"
                    maxlength="100"
                >
                <div class="error" id="nameError">Please enter your full name</div>
            </div>
            
            <div class="form-group">
                <label for="mobile">
                    Mobile Number <span class="required">*</span>
                </label>
                <input 
                    type="tel" 
                    id="mobile" 
                    name="mobile" 
                    required 
                    placeholder="10-digit mobile number"
                    pattern="[0-9]{{10}}"
                    maxlength="10"
                >
                <div class="error" id="mobileError">Please enter a valid 10-digit mobile number</div>
            </div>
            
            <div class="form-group">
                <label for="constituency">
                    Constituency <span class="required">*</span>
                </label>
                <input 
                    type="text" 
                    id="constituency" 
                    name="constituency" 
                    required 
                    placeholder="Enter your constituency name"
                    maxlength="100"
                >
                <div class="error" id="constituencyError">Please enter your constituency</div>
            </div>
            
            <div class="form-group">
                <label for="query">
                    Your Query <span class="required">*</span>
                </label>
                <textarea 
                    id="query" 
                    name="query" 
                    required 
                    placeholder="Describe your query or concern in detail..."
                    maxlength="1000"
                ></textarea>
                <div class="char-count">
                    <span id="charCount">0</span> / 1000 characters
                </div>
                <div class="error" id="queryError">Please describe your query</div>
            </div>
            
            <div class="form-group">
                <label for="attachment">
                    Attachment (Optional)
                </label>
                <input 
                    type="file" 
                    id="attachment" 
                    name="attachment" 
                    accept="image/*,.pdf,.doc,.docx"
                    class="file-input"
                >
                <div class="file-info">
                    Accepted: Images, PDF, Word documents (Max 5MB)
                </div>
            </div>
            
            <div class="form-group">
                <label for="audio">
                    Audio Recording (Optional)
                </label>
                <input 
                    type="file" 
                    id="audio" 
                    name="audio" 
                    accept="audio/*"
                    class="file-input"
                >
                <div class="file-info">
                    Accepted: Audio files (Max 10MB)
                </div>
            </div>
            
            <button type="submit" class="submit-btn" id="submitBtn">
                Submit Query
            </button>
        </form>
    </div>
    
    <script>
        // Character counter for query field
        const queryField = document.getElementById('query');
        const charCount = document.getElementById('charCount');
        
        queryField.addEventListener('input', function() {{
            charCount.textContent = this.value.length;
        }});
        
        // Mobile number validation
        const mobileField = document.getElementById('mobile');
        mobileField.addEventListener('input', function() {{
            this.value = this.value.replace(/[^0-9]/g, '');
        }});
        
        // File size validation
        const attachmentField = document.getElementById('attachment');
        const audioField = document.getElementById('audio');
        
        attachmentField.addEventListener('change', function() {{
            if (this.files.length > 0) {{
                const fileSize = this.files[0].size / 1024 / 1024; // Convert to MB
                if (fileSize > 5) {{
                    alert('Attachment file size must be less than 5MB');
                    this.value = '';
                }}
            }}
        }});
        
        audioField.addEventListener('change', function() {{
            if (this.files.length > 0) {{
                const fileSize = this.files[0].size / 1024 / 1024; // Convert to MB
                if (fileSize > 10) {{
                    alert('Audio file size must be less than 10MB');
                    this.value = '';
                }}
            }}
        }});
        
        // Form validation and submission
        const form = document.getElementById('citizenForm');
        const submitBtn = document.getElementById('submitBtn');
        
        form.addEventListener('submit', async function(e) {{
            e.preventDefault();
            
            // Clear previous errors
            document.querySelectorAll('.error').forEach(el => el.classList.remove('show'));
            
            // Validate fields
            let isValid = true;
            
            const name = document.getElementById('name').value.trim();
            if (!name) {{
                document.getElementById('nameError').classList.add('show');
                isValid = false;
            }}
            
            const mobile = document.getElementById('mobile').value.trim();
            if (!/^[0-9]{{10}}$/.test(mobile)) {{
                document.getElementById('mobileError').classList.add('show');
                isValid = false;
            }}
            
            const constituency = document.getElementById('constituency').value.trim();
            if (!constituency) {{
                document.getElementById('constituencyError').classList.add('show');
                isValid = false;
            }}
            
            const query = document.getElementById('query').value.trim();
            if (!query) {{
                document.getElementById('queryError').classList.add('show');
                isValid = false;
            }}
            
            if (!isValid) return;
            
            // Disable submit button
            submitBtn.disabled = true;
            submitBtn.textContent = 'Submitting...';
            
            // Submit form
            try {{
                const formData = new FormData(form);
                const response = await fetch('/api/v1/form/submit', {{
                    method: 'POST',
                    body: formData
                }});
                
                if (response.ok) {{
                    // Success - redirect to success page
                    window.location.href = '/form/success';
                }} else {{
                    const error = await response.json();
                    alert('Error: ' + (error.detail || 'Submission failed'));
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Submit Query';
                }}
            }} catch (error) {{
                alert('Network error. Please try again.');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit Query';
            }}
        }});
    </script>
</body>
</html>
        """
        
        return HTMLResponse(content=html_content)
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error displaying form: {str(e)}"
        )
