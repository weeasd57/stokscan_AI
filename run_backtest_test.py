#!/usr/bin/env python3
"""
Quick test runner for the enhanced backtest system.

Usage:
    python run_backtest_test.py           # Run all tests
    python run_backtest_test.py --unit    # Run unit tests only
    python run_backtest_test.py --demo    # Run demo comparison
    python run_backtest_test.py --config  # Show configuration
"""

import os
import sys
import argparse
import subprocess
from pathlib import Path

def run_unit_tests():
    """Run unit tests for portfolio manager"""
    print("🧪 Running Unit Tests...")
    print("=" * 60)
    
    test_file = Path("tests/test_portfolio_manager.py")
    
    if not test_file.exists():
        print(f"❌ Test file not found: {test_file}")
        return False
    
    try:
        result = subprocess.run([
            sys.executable, "-m", "unittest", 
            "tests.test_portfolio_manager", 
            "-v"
        ], cwd=Path(__file__).parent, capture_output=True, text=True)
        
        print(result.stdout)
        if result.stderr:
            print("STDERR:", result.stderr)
        
        if result.returncode == 0:
            print("✅ All unit tests passed!")
            return True
        else:
            print("❌ Some unit tests failed!")
            return False
    
    except Exception as e:
        print(f"❌ Error running tests: {e}")
        return False

def run_demo_comparison():
    """Run demo comparison between old and new systems"""
    print("🎯 Running Demo Comparison...")
    print("=" * 60)
    
    demo_file = Path("test_enhanced_backtest.py")
    
    if not demo_file.exists():
        print(f"❌ Demo file not found: {demo_file}")
        return False
    
    try:
        result = subprocess.run([
            sys.executable, str(demo_file)
        ], cwd=Path(__file__).parent, capture_output=True, text=True)
        
        print(result.stdout)
        if result.stderr:
            print("STDERR:", result.stderr)
        
        if result.returncode == 0:
            print("✅ Demo completed successfully!")
            return True
        else:
            print("❌ Demo failed!")
            return False
    
    except Exception as e:
        print(f"❌ Error running demo: {e}")
        return False

def show_configuration():
    """Show current backtest configuration"""
    print("⚙️  Current Backtest Configuration")
    print("=" * 60)
    
    # Add api to path
    sys.path.append(str(Path(__file__).parent / "api"))
    
    try:
        from api.backtest_config import BacktestConfig
        
        BacktestConfig.log_configuration()
        
        # Show environment variables
        print("\nEnvironment Variables:")
        backtest_vars = {k: v for k, v in os.environ.items() if k.startswith(('USE_ENHANCED_BACKTEST', 'BT_'))}
        
        if backtest_vars:
            for key, value in backtest_vars.items():
                print(f"  {key}={value}")
        else:
            print("  No backtest-specific environment variables set")
        
        print("\nConfiguration Files:")
        config_files = [
            ".env",
            ".env.local", 
            ".env.backtest",
            "web/.env.local"
        ]
        
        for config_file in config_files:
            file_path = Path(config_file)
            if file_path.exists():
                print(f"  ✅ {config_file}")
            else:
                print(f"  ❌ {config_file} (not found)")
        
        return True
    
    except Exception as e:
        print(f"❌ Error showing configuration: {e}")
        return False

def check_dependencies():
    """Check if required dependencies are available"""
    print("📦 Checking Dependencies...")
    print("=" * 60)
    
    required_packages = [
        "pandas",
        "numpy", 
        "datetime"
    ]
    
    missing = []
    
    for package in required_packages:
        try:
            __import__(package)
            print(f"  ✅ {package}")
        except ImportError:
            print(f"  ❌ {package} (missing)")
            missing.append(package)
    
    if missing:
        print(f"\n❌ Missing packages: {', '.join(missing)}")
        print("Install with: pip install " + " ".join(missing))
        return False
    else:
        print("\n✅ All dependencies available!")
        return True

def check_file_structure():
    """Check if required files exist"""
    print("📁 Checking File Structure...")
    print("=" * 60)
    
    required_files = [
        "api/portfolio_manager.py",
        "api/backtest_config.py", 
        "api/backtest_radar.py",
        "api/main.py",
        "test_enhanced_backtest.py",
        "tests/test_portfolio_manager.py"
    ]
    
    missing = []
    
    for file_path in required_files:
        path = Path(file_path)
        if path.exists():
            print(f"  ✅ {file_path}")
        else:
            print(f"  ❌ {file_path} (missing)")
            missing.append(file_path)
    
    if missing:
        print(f"\n❌ Missing files: {len(missing)}")
        return False
    else:
        print("\n✅ All required files present!")
        return True

def main():
    """Main function"""
    parser = argparse.ArgumentParser(description="Enhanced Backtest System Test Runner")
    parser.add_argument("--unit", action="store_true", help="Run unit tests only")
    parser.add_argument("--demo", action="store_true", help="Run demo comparison")
    parser.add_argument("--config", action="store_true", help="Show configuration")
    parser.add_argument("--check", action="store_true", help="Check setup only")
    
    args = parser.parse_args()
    
    print("🚀 Enhanced Backtest System Test Runner")
    print("=" * 60)
    
    # Always check setup first
    deps_ok = check_dependencies()
    files_ok = check_file_structure()
    
    if not (deps_ok and files_ok):
        print("\n❌ Setup check failed! Please fix issues above.")
        return False
    
    if args.check:
        print("\n✅ Setup check passed!")
        return True
    
    success = True
    
    # Run specific tests based on arguments
    if args.config:
        success &= show_configuration()
    elif args.unit:
        success &= run_unit_tests()
    elif args.demo:
        success &= run_demo_comparison()
    else:
        # Run all tests
        print("\n" + "="*60)
        success &= show_configuration()
        
        print("\n" + "="*60) 
        success &= run_unit_tests()
        
        print("\n" + "="*60)
        success &= run_demo_comparison()
    
    # Summary
    print("\n" + "="*60)
    if success:
        print("🎉 All tests completed successfully!")
        print("\nNext steps:")
        print("1. Review the test results above")
        print("2. Check that returns are realistic (not 7000%+)")
        print("3. Deploy to production when ready")
        print("4. Monitor results for a few days")
    else:
        print("❌ Some tests failed. Please review the output above.")
    
    return success

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)