"""
Utility functions for the citizen scheduler application.
Provides helper functions for security, fingerprinting, and common operations.
"""
import hashlib
from fastapi import Request


def generate_device_fingerprint(request: Request) -> str:
    """
    Generate a unique device fingerprint from request metadata.
    
    Combines multiple HTTP headers and client information to create
    a semi-unique identifier for the device/browser making the request.
    
    Components used:
        - Client IP address
        - User-Agent (browser/OS information)
        - Accept-Language (user's language preferences)
        - Accept-Encoding (compression methods supported)
        - Accept (content types accepted)
    
    Args:
        request: FastAPI Request object containing headers and client info
    
    Returns:
        str: 32-character hexadecimal hash representing the device fingerprint
    
    Security Notes:
        - Not 100% unique (multiple users behind same proxy may collide)
        - Resistant to simple replay attacks from different devices
        - Should be combined with other security measures
        - IP address may change (mobile networks, VPNs)
    
    Example:
        >>> fingerprint = generate_device_fingerprint(request)
        >>> print(fingerprint)
        'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'
    """
    components = [
        # Network layer - Client IP address
        request.client.host if request.client else "unknown",
        
        # Browser identification
        request.headers.get("user-agent", ""),
        
        # Locale and preferences
        request.headers.get("accept-language", ""),
        request.headers.get("accept-encoding", ""),
        request.headers.get("accept", ""),
        
        # Optional: Chrome User-Agent Client Hints (modern browsers)
        request.headers.get("sec-ch-ua", ""),
        request.headers.get("sec-ch-ua-platform", ""),
        request.headers.get("sec-ch-ua-mobile", ""),
    ]
    
    # Filter out empty values and join with delimiter
    fingerprint_string = "|".join(filter(None, components))
    
    # Generate SHA-256 hash and truncate to 32 characters
    hash_object = hashlib.sha256(fingerprint_string.encode('utf-8'))
    return hash_object.hexdigest()[:32]


def generate_enhanced_device_fingerprint(
    request: Request,
    client_fingerprint: str = None
) -> str:
    """
    Generate an enhanced device fingerprint combining server and client data.
    
    This function combines server-side fingerprinting (from request headers)
    with optional client-side fingerprinting (Canvas, WebGL, fonts, etc.)
    for stronger uniqueness.
    
    Args:
        request: FastAPI Request object
        client_fingerprint: Optional client-side fingerprint from frontend
                           (e.g., from FingerprintJS or custom implementation)
    
    Returns:
        str: 32-character hexadecimal hash representing enhanced fingerprint
    
    Example:
        >>> # Server-side only
        >>> fp = generate_enhanced_device_fingerprint(request)
        >>> 
        >>> # Combined with client-side data
        >>> fp = generate_enhanced_device_fingerprint(request, "client_fp_abc123")
    """
    # Always generate server-side fingerprint
    server_fp = generate_device_fingerprint(request)
    
    # If client provides enhanced fingerprint, combine both
    if client_fingerprint:
        combined = f"{server_fp}:{client_fingerprint}"
        hash_object = hashlib.sha256(combined.encode('utf-8'))
        return hash_object.hexdigest()[:32]
    
    return server_fp
