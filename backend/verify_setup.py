"""
Setup verification script.
Checks that all dependencies and files are correctly configured.
"""
import sys
import os
from pathlib import Path


def check_python_version():
    """Verify Python version is 3.10+"""
    version = sys.version_info
    if version.major < 3 or (version.major == 3 and version.minor < 10):
        print("❌ Python 3.10+ required. Current:", f"{version.major}.{version.minor}")
        return False
    print(f"✓ Python version: {version.major}.{version.minor}.{version.micro}")
    return True


def check_dependencies():
    """Verify all required packages are installed"""
    required_packages = [
        'fastapi',
        'uvicorn',
        'sqlalchemy',
        'psycopg',
        'itsdangerous',
        'pydantic',
        'pydantic_settings',
    ]
    
    missing = []
    for package in required_packages:
        try:
            __import__(package)
            print(f"✓ {package} installed")
        except ImportError:
            missing.append(package)
            print(f"❌ {package} NOT installed")
    
    if missing:
        print(f"\n❌ Missing packages: {', '.join(missing)}")
        print("Run: pip install -r requirements.txt")
        return False
    
    return True


def check_project_structure():
    """Verify all required files and directories exist"""
    base_path = Path(__file__).parent
    
    required_files = [
        'src/__init__.py',
        'src/main.py',
        'src/core/__init__.py',
        'src/core/config.py',
        'src/core/database.py',
        'src/models/__init__.py',
        'src/models/qr_models.py',
        'src/services/__init__.py',
        'src/services/qr_service.py',
        'src/api/__init__.py',
        'src/api/v1/__init__.py',
        'src/api/v1/qr.py',
        'create_tables.py',
        'requirements.txt',
        '.env.example',
    ]
    
    missing = []
    for file_path in required_files:
        full_path = base_path / file_path
        if full_path.exists():
            print(f"✓ {file_path}")
        else:
            missing.append(file_path)
            print(f"❌ {file_path} NOT found")
    
    if missing:
        print(f"\n❌ Missing files: {', '.join(missing)}")
        return False
    
    return True


def check_env_file():
    """Check if .env file exists"""
    env_path = Path(__file__).parent / '.env'
    if env_path.exists():
        print("✓ .env file exists")
        return True
    else:
        print("⚠️  .env file NOT found")
        print("   Copy .env.example to .env and configure it")
        return False


def check_imports():
    """Verify that core modules can be imported"""
    try:
        from src.core.config import settings
        print("✓ src.core.config imports successfully")
        
        from src.core.database import Base, engine, get_db
        print("✓ src.core.database imports successfully")
        
        from src.models.qr_models import QRLog, GatekeeperSession
        print("✓ src.models.qr_models imports successfully")
        
        from src.services.qr_service import qr_service
        print("✓ src.services.qr_service imports successfully")
        
        from src.api.v1.qr import router
        print("✓ src.api.v1.qr imports successfully")
        
        from src.main import app
        print("✓ src.main imports successfully")
        
        return True
    except Exception as e:
        print(f"❌ Import error: {e}")
        return False


def main():
    """Run all verification checks"""
    print("=" * 60)
    print("Module 1 Setup Verification")
    print("=" * 60)
    print()
    
    checks = [
        ("Python Version", check_python_version),
        ("Dependencies", check_dependencies),
        ("Project Structure", check_project_structure),
        ("Environment File", check_env_file),
        ("Module Imports", check_imports),
    ]
    
    results = []
    for name, check_func in checks:
        print(f"\n{name}:")
        print("-" * 60)
        result = check_func()
        results.append((name, result))
        print()
    
    print("=" * 60)
    print("Verification Summary")
    print("=" * 60)
    
    all_passed = True
    for name, result in results:
        status = "✓ PASS" if result else "❌ FAIL"
        print(f"{status}: {name}")
        if not result:
            all_passed = False
    
    print()
    if all_passed:
        print("🎉 All checks passed! Your setup is ready.")
        print()
        print("Next steps:")
        print("1. Configure .env file with your database credentials")
        print("2. Run: python create_tables.py")
        print("3. Run: uvicorn src.main:app --reload")
        print("4. Visit: http://localhost:8000/api/docs")
        return 0
    else:
        print("⚠️  Some checks failed. Please fix the issues above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
