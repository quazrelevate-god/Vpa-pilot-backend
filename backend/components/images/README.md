# Images Directory

⚠️ **DEPRECATED**: This directory is no longer used.

## Current Setup

Images are now served from the `assets/` folder in the backend root directory.

## Current Images in Use

The form now uses:
- **Left Header**: `/static/assets/TN-logo.jpeg` - Tamil Nadu Government logo
- **Right Header**: `/static/assets/CM-vijay.jpg` - Chief Minister photo

## Location

Images are located at: `backend/assets/`

Served via FastAPI's StaticFiles at: `/static/assets/`

## Adding New Images

Place images in the `backend/assets/` directory and reference them as:
```html
<img src="/static/assets/your-image.jpg">
```
