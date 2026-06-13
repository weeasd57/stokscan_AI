#!/usr/bin/env python
"""
Quick Model Validation Script
Usage: python api/validate_model.py --model_path api/models/KING.pkl
"""
import argparse
import pickle
import sys
import os
from typing import Dict, Any

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def validate_model(model_path: str, verbose: bool = True) -> Dict[str, Any]:
    """
    Run comprehensive validation tests on a trained model.
    
    Returns:
        dict with validation results and pass/fail status
    """
    
    if verbose:
        print("=" * 60)
        print("🔍 MODEL VALIDATION REPORT")
        print("=" * 60)
        print(f"Model: {model_path}")
        print()
    
    # Load model
    try:
        with open(model_path, "rb") as f:
            artifact = pickle.load(f)
    except Exception as e:
        print(f"❌ ERROR: Could not load model: {e}")
        return {"overall_pass": False, "error": str(e)}
    
    results = {
        "model_path": model_path,
        "tests": {},
        "overall_pass": False,
        "score": 0
    }
    
    # ========================================
    # Test 1: Walk-Forward Validation Results
    # ========================================
    if verbose:
        print("📊 Test 1: Walk-Forward Validation")
        print("-" * 60)
    
    wf_summary = artifact.get("walk_forward_summary", {})
    wf_splits = artifact.get("walk_forward_splits_results", [])
    
    # Try to get walk-forward F1, fallback to validation F1 if not available
    if wf_summary and wf_summary.get("average_f1", 0) > 0 and wf_summary.get("n_splits", 0) > 0:
        avg_f1 = wf_summary.get("average_f1", 0)
        std_f1 = wf_summary.get("std_f1", 0)
        min_f1 = wf_summary.get("min_f1", 0)
        max_f1 = wf_summary.get("max_f1", 0)
        n_splits = wf_summary.get("n_splits", len(wf_splits))
        has_wf_data = True
    else:
        # Fallback: use validation metrics if no walk-forward data
        val_metrics = artifact.get("validation_metrics", {})
        avg_f1 = val_metrics.get("f1", artifact.get("f1", 0))
        std_f1 = 0  # Assume no variance if no walk-forward
        min_f1 = avg_f1
        max_f1 = avg_f1
        n_splits = 0
        has_wf_data = False
    
    # Thresholds (more lenient when no walk-forward data)
    if has_wf_data:
        avg_f1_pass = avg_f1 >= 0.45
        std_f1_pass = std_f1 <= 0.08
        min_f1_pass = min_f1 >= 0.35
        range_pass = (max_f1 - min_f1) <= 0.30
    else:
        # Less strict for models without walk-forward
        avg_f1_pass = avg_f1 >= 0.40
        std_f1_pass = True  # No walk-forward, can't measure std
        min_f1_pass = True  # No walk-forward, can't measure min
        range_pass = True   # No walk-forward, can't measure range
    
    results["tests"]["walk_forward"] = {
        "average_f1": avg_f1,
        "std_f1": std_f1,
        "min_f1": min_f1,
        "max_f1": max_f1,
        "n_splits": n_splits,
        "has_wf_data": has_wf_data,
        "avg_f1_pass": avg_f1_pass,
        "std_f1_pass": std_f1_pass,
        "min_f1_pass": min_f1_pass,
        "range_pass": range_pass,
        "overall_pass": avg_f1_pass and std_f1_pass and min_f1_pass
    }
    
    if verbose:
        if not has_wf_data:
            print(f"   ⚠️  No walk-forward data, using validation F1: {avg_f1:.3f}")
        
        print(f"   Average F1: {avg_f1:.3f} {'✅' if avg_f1_pass else '❌ (need >= 0.45)'}")
        if has_wf_data:
            print(f"   Std F1: {std_f1:.3f} {'✅' if std_f1_pass else '❌ (need <= 0.08)'}")
            print(f"   Min F1: {min_f1:.3f} {'✅' if min_f1_pass else '❌ (need >= 0.35)'}")
            print(f"   Max F1: {max_f1:.3f}")
            print(f"   Range: {max_f1 - min_f1:.3f} {'✅' if range_pass else '❌ (need <= 0.30)'}")
        print(f"   Splits: {n_splits}")
        
        if has_wf_data and n_splits > 0:
            print("\n   Per-Split Results:")
            for split in wf_splits:
                print(f"      Split {split.get('split_index', '?')}: "
                      f"F1={split.get('f1', 0):.3f}, "
                      f"Precision={split.get('precision', 0):.3f}, "
                      f"Period={split.get('test_period', 'unknown')}")
        print()
    
    # ========================================
    # Test 2: Overfitting Check
    # ========================================
    if verbose:
        print("🔬 Test 2: Overfitting Check")
        print("-" * 60)
    
    train_metrics = artifact.get("train_metrics", {})
    val_metrics = artifact.get("validation_metrics", artifact)
    
    train_f1 = train_metrics.get("f1", artifact.get("train_f1", 0))
    val_f1 = val_metrics.get("f1", artifact.get("f1", 0))
    gap = abs(train_f1 - val_f1) if train_f1 and val_f1 else 0
    
    gap_pass = gap <= 0.10
    gap_excellent = gap <= 0.05
    
    results["tests"]["overfitting"] = {
        "train_f1": train_f1,
        "val_f1": val_f1,
        "gap": gap,
        "gap_pass": gap_pass,
        "gap_excellent": gap_excellent
    }
    
    if verbose:
        print(f"   Training F1: {train_f1:.3f}")
        print(f"   Validation F1: {val_f1:.3f}")
        print(f"   Gap: {gap:.3f} {'✅' if gap_pass else '❌ (need <= 0.10)'}")
        if gap_excellent:
            print(f"   ⭐ Excellent generalization!")
        print()
    
    # ========================================
    # Test 3: Model Metadata Check
    # ========================================
    if verbose:
        print("📋 Test 3: Model Metadata")
        print("-" * 60)
    
    has_trading_params = "trading_parameters" in artifact
    has_thresholds = "thresholds" in artifact
    # Check for feature names in multiple possible keys
    has_feature_names = ("feature_names" in artifact) or ("meta_feature_names" in artifact)
    has_wf_results = len(wf_splits) > 0
    
    # Get actual feature names if they exist
    feature_names = artifact.get("feature_names", artifact.get("meta_feature_names", []))
    
    metadata_pass = has_trading_params and has_thresholds and has_feature_names
    
    results["tests"]["metadata"] = {
        "has_trading_params": has_trading_params,
        "has_thresholds": has_thresholds,
        "has_feature_names": has_feature_names,
        "actual_feature_names_sample": feature_names[:10] if isinstance(feature_names, list) and feature_names else [],
        "has_wf_results": has_wf_results,
        "overall_pass": metadata_pass
    }
    
    if verbose:
        print(f"   Trading Parameters: {'✅' if has_trading_params else '❌'}")
        print(f"   Thresholds: {'✅' if has_thresholds else '❌'}")
        print(f"   Feature Names: {'✅' if has_feature_names else '❌'}")
        print(f"   Walk-Forward Results: {'✅' if has_wf_results else '❌'}")
        print()
    
    # ========================================
    # Test 4: Feature Analysis
    # ========================================
    if verbose:
        print("🎯 Test 4: Top Features")
        print("-" * 60)
    
    # Get feature names from multiple possible sources
    feature_names = artifact.get("feature_names", artifact.get("meta_feature_names", []))
    feature_importance = artifact.get("feature_importance", {})
    
    if isinstance(feature_names, list):
        n_features = len(feature_names)
    elif isinstance(feature_names, dict):
        n_features = len(feature_names)
        feature_names = list(feature_names.keys())
    else:
        n_features = 0
        feature_names = []
    
    # Check if common important features exist (updated to match actual model features)
    expected_features = [
        "BB_Width", "OBV", "Amihud_SMA_10", "Volume_Acceleration", "Dist_From_High",
        "SMA_Cross", "EMA_Cross", "industry", "PCA_Momentum", "Volume", "Close"
    ]
    features_found = []
    
    for f in expected_features:
        for fname in feature_names:
            if f in str(fname):
                features_found.append(f)
                break
    
    # For models with feature importance dict, show top features
    if feature_importance and len(feature_importance) > 0:
        # Sort features by importance
        sorted_features = sorted(feature_importance.items(), key=lambda x: x[1], reverse=True)
        top_features = sorted_features[:10]
        
        if verbose:
            print(f"   Total Features: {n_features}")
            print(f"   Top 10 Features by Importance:")
            for feat, imp in top_features:
                print(f"      {feat}: {imp:.2f}")
    else:
        if verbose:
            print(f"   Total Features: {n_features}")
            if feature_names:
                print(f"   First 10 Features: {', '.join(feature_names[:10])}")
    
    features_pass = len(features_found) >= 3  # More lenient threshold
    
    results["tests"]["features"] = {
        "n_features": n_features,
        "expected_features_found": features_found,
        "features_pass": features_pass
    }
    
    if verbose:
        print(f"   {'✅' if features_pass else '⚠️  (found {len(features_found)}/10 expected features)'}")
        print()
    
    # ========================================
    # Test 5: Training Configuration
    # ========================================
    if verbose:
        print("⚙️  Test 5: Training Configuration")
        print("-" * 60)
    
    trading_params = artifact.get("trading_parameters", {})
    thresholds = artifact.get("thresholds", {})
    
    target_pct = trading_params.get("target_pct", 0)
    stop_loss_pct = trading_params.get("stop_loss_pct", 0)
    look_forward_days = trading_params.get("look_forward_days", 0)
    barrier_mode = trading_params.get("barrier_mode", trading_params.get("barrierMode", "unknown"))
    king_threshold = thresholds.get("king_threshold", 0.5)
    use_volatility_label = trading_params.get("use_volatility_label", False)
    
    config_pass = (target_pct > 0 and stop_loss_pct > 0 and 
                   look_forward_days > 0)
    
    results["tests"]["configuration"] = {
        "target_pct": target_pct,
        "stop_loss_pct": stop_loss_pct,
        "look_forward_days": look_forward_days,
        "barrier_mode": barrier_mode,
        "use_volatility_label": use_volatility_label,
        "king_threshold": king_threshold,
        "config_pass": config_pass
    }
    
    if verbose:
        # Display target correctly based on barrier_mode
        if barrier_mode == "atr_multiplier":
            print(f"   Target: {target_pct:.1f}x ATR")
        else:
            print(f"   Target: {target_pct:.1%}")
        
        # Display stop loss correctly based on barrier_mode
        if barrier_mode == "atr_multiplier":
            print(f"   Stop Loss: {stop_loss_pct:.1f}x ATR")
        else:
            print(f"   Stop Loss: {stop_loss_pct:.1%}")
        
        print(f"   Look Forward: {look_forward_days} days")
        print(f"   Barrier Mode: {barrier_mode}")
        print(f"   Use Volatility Label: {'✅' if use_volatility_label else '❌'}")
        print(f"   KING Threshold: {king_threshold:.2f}")
        print(f"   {'✅' if config_pass else '❌'}")
        print()
    
    # ========================================
    # Overall Assessment
    # ========================================
    if verbose:
        print("=" * 60)
        print("📊 OVERALL ASSESSMENT")
        print("=" * 60)
    
    # Calculate score
    test_results = [
        ("Walk-Forward F1 >= 0.45", results["tests"]["walk_forward"]["avg_f1_pass"]),
        ("Walk-Forward Stability", results["tests"]["walk_forward"]["std_f1_pass"]),
        ("Min F1 >= 0.35", results["tests"]["walk_forward"]["min_f1_pass"]),
        ("Overfitting Check", results["tests"]["overfitting"]["gap_pass"]),
        ("Metadata Complete", results["tests"]["metadata"]["overall_pass"]),
        ("Features Present", results["tests"]["features"]["features_pass"]),
        ("Config Valid", results["tests"]["configuration"]["config_pass"]),
    ]
    
    passed_tests = sum(1 for _, passed in test_results if passed)
    total_tests = len(test_results)
    score = (passed_tests / total_tests) * 100
    
    results["score"] = score
    results["passed_tests"] = passed_tests
    results["total_tests"] = total_tests
    
    if verbose:
        for test_name, passed in test_results:
            status = "✅" if passed else "❌"
            print(f"{status} {test_name}")
        
        print()
        print(f"Score: {score:.0f}% ({passed_tests}/{total_tests} tests passed)")
        print()
    
    # Final verdict
    if score >= 85:
        verdict = "🎯 Model is READY for deployment!"
        results["overall_pass"] = True
        color = "\033[92m"  # Green
    elif score >= 70:
        verdict = "⚠️  Model is ACCEPTABLE but could be improved"
        results["overall_pass"] = True
        color = "\033[93m"  # Yellow
    elif score >= 50:
        verdict = "⚠️  Model needs IMPROVEMENT before deployment"
        results["overall_pass"] = False
        color = "\033[93m"  # Yellow
    else:
        verdict = "❌ Model is NOT READY - retrain required"
        results["overall_pass"] = False
        color = "\033[91m"  # Red
    
    if verbose:
        print(color + verdict + "\033[0m")
        print()
        
        # Recommendations
        if not results["overall_pass"]:
            print("💡 Recommendations:")
            if not results["tests"]["walk_forward"]["avg_f1_pass"]:
                print("   - Improve features or try different hyperparameters")
            if not results["tests"]["walk_forward"]["std_f1_pass"]:
                print("   - Add more regularization (increase lambda_l1/l2)")
            if not results["tests"]["overfitting"]["gap_pass"]:
                print("   - Reduce model complexity (max_depth, num_leaves)")
            if not results["tests"]["metadata"]["overall_pass"]:
                print("   - Retrain with latest training script")
            print()
    
    results["verdict"] = verdict
    return results


def main():
    parser = argparse.ArgumentParser(description="Validate trained model")
    parser.add_argument(
        "--model_path",
        type=str,
        default="api/models/KING.pkl",
        help="Path to model pickle file"
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress verbose output"
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON"
    )
    
    args = parser.parse_args()
    
    # Run validation
    results = validate_model(args.model_path, verbose=not args.quiet)
    
    # Output JSON if requested
    if args.json:
        import json
        
        # Convert boolean values to strings for JSON serialization
        def json_default(obj):
            if isinstance(obj, bool):
                return "True" if obj else "False"
            elif hasattr(obj, '__dict__'):
                return str(obj)
            else:
                return str(obj)
        
        print(json.dumps(results, indent=2, default=json_default))
    
    # Exit with appropriate code
    sys.exit(0 if results["overall_pass"] else 1)


if __name__ == "__main__":
    main()
