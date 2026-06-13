"""
Unified Feature Engineering Validation Module

This module ensures consistent feature engineering and data validation
across training, live bot, and backtesting.

It handles:
- Data readiness checks
- Feature presence validation
- Warmup period calculation
- Data leakage detection
- Feature drift monitoring
"""

from typing import Tuple, List, Dict, Any, Optional
import pandas as pd
import numpy as np
from dataclasses import dataclass

from api.trading_config import TradingParameters


@dataclass
class DataReadinessReport:
    """Report on whether data is ready for trading"""
    is_ready: bool
    bars_count: int
    min_bars_required: int
    nan_percentage: float = 0.0
    max_nan_acceptable: float = 0.25  # Raised from 0.05 — EGX fundamentals columns are often sparse
    missing_columns: List[str] = None
    warnings: List[str] = None
    
    def __post_init__(self):
        if self.missing_columns is None:
            self.missing_columns = []
        if self.warnings is None:
            self.warnings = []
    
    def summary(self) -> str:
        """Human-readable summary"""
        status = "✅ READY" if self.is_ready else "❌ NOT READY"
        msg = f"\n{status}\n"
        msg += f"Bars: {self.bars_count} (need {self.min_bars_required})\n"
        msg += f"NaN: {self.nan_percentage:.1%} (max {self.max_nan_acceptable:.1%})\n"
        
        if self.missing_columns:
            msg += f"Missing columns: {self.missing_columns}\n"
        
        if self.warnings:
            msg += f"Warnings:\n"
            for w in self.warnings:
                msg += f"  - {w}\n"
        
        return msg


class FeatureEngineeringManager:
    """
    Manages consistent feature engineering across all components.
    """
    
    def __init__(self, params: TradingParameters):
        """
        Initialize with trading parameters.
        
        Args:
            params: TradingParameters instance
        """
        self.params = params
    
    def check_data_ready(
        self,
        bars: pd.DataFrame,
        extra_checks: bool = True
    ) -> DataReadinessReport:
        """
        Comprehensive data readiness check.
        
        Args:
            bars: DataFrame with OHLCV data
            extra_checks: If True, perform additional validation
            
        Returns:
            DataReadinessReport with detailed status
        """
        report = DataReadinessReport(
            is_ready=True,
            bars_count=len(bars),
            min_bars_required=self.params.min_history_needed,
        )
        
        # Check 1: Minimum bars required
        if len(bars) < self.params.min_history_needed:
            report.is_ready = False
            report.warnings.append(
                f"Insufficient data: {len(bars)} bars, need {self.params.min_history_needed}"
            )
        
        # Check 2: NaN percentage
        if bars.empty:
            report.is_ready = False
            report.warnings.append("Empty DataFrame")
            return report
        
        nan_count = bars.isna().sum().sum()
        total_cells = len(bars) * len(bars.columns)
        report.nan_percentage = nan_count / total_cells if total_cells > 0 else 0
        
        if report.nan_percentage > report.max_nan_acceptable:
            report.is_ready = False
            report.warnings.append(
                f"Too many NaN values: {report.nan_percentage:.1%} (max {report.max_nan_acceptable:.1%})"
            )
        
        # Check 3: Required columns
        required_cols = ["open", "high", "low", "close", "volume"]
        required_cols_upper = ["Open", "High", "Low", "Close", "Volume"]
        
        for col_lower, col_upper in zip(required_cols, required_cols_upper):
            if col_lower not in bars.columns and col_upper not in bars.columns:
                report.is_ready = False
                report.missing_columns.append(col_lower)
        
        if extra_checks:
            report = self._extra_checks(bars, report)
        
        return report
    
    def _extra_checks(
        self,
        bars: pd.DataFrame,
        report: DataReadinessReport
    ) -> DataReadinessReport:
        """
        Additional validation checks.
        """
        # Check for weird prices (e.g., high < low)
        close_col = "Close" if "Close" in bars.columns else "close"
        high_col = "High" if "High" in bars.columns else "high"
        low_col = "Low" if "Low" in bars.columns else "low"
        volume_col = "Volume" if "Volume" in bars.columns else "volume"
        
        # Check price relationships
        if all(c in bars.columns for c in [high_col, low_col, close_col]):
            invalid_high_low = (bars[high_col] < bars[low_col]).sum()
            if invalid_high_low > 0:
                report.warnings.append(
                    f"{invalid_high_low} bars have high < low (data quality issue)"
                )
        
        # Check for zero or negative prices
        if close_col in bars.columns:
            zero_price = (bars[close_col] <= 0).sum()
            if zero_price > 0:
                report.warnings.append(
                    f"{zero_price} bars have price <= 0"
                )
        
        # Check volume
        if volume_col in bars.columns:
            zero_vol = (bars[volume_col] <= 0).sum()
            if zero_vol > len(bars) * 0.1:  # More than 10%
                report.warnings.append(
                    f"{zero_vol} bars have zero volume (may affect signals)"
                )
        
        return report
    
    def get_warmup_skip(self) -> int:
        """
        Get number of bars to skip at the start due to indicator requirements.
        
        This ensures all indicators have enough history before prediction.
        
        Returns:
            Number of bars to skip
        """
        return max(
            self.params.warmup_bars,
            self.params.min_history_needed,
            self.params.feature_lookback,
        )
    
    def validate_features(
        self,
        X: pd.DataFrame,
        expected_features: List[str],
        categorical_features: Optional[List[str]] = None,
    ) -> Tuple[bool, List[str], Dict[str, Any]]:
        """
        Validate that required features are present and valid.
        
        Args:
            X: Feature DataFrame
            expected_features: List of expected feature names
            categorical_features: List of categorical feature names
            
        Returns:
            (is_valid, missing_features, issues_dict)
        """
        missing = []
        issues = {}
        
        # Check for missing features
        for feat in expected_features:
            if feat not in X.columns:
                missing.append(feat)
                issues[feat] = "Missing from DataFrame"
        
        # Check for all-NaN features
        for feat in expected_features:
            if feat in X.columns:
                if X[feat].isna().all():
                    issues[feat] = "All values are NaN"
                elif X[feat].isna().mean() > 0.5:
                    issues[feat] = f"{X[feat].isna().mean():.1%} values are NaN"
        
        # Check categorical features
        if categorical_features:
            for feat in categorical_features:
                if feat in X.columns:
                    if X[feat].dtype not in ["object", "category"]:
                        issues[feat] = f"Not categorical: dtype={X[feat].dtype}"
        
        # Check for infinite values
        numeric_cols = X.select_dtypes(include=[np.number]).columns
        for col in numeric_cols:
            if np.isinf(X[col]).any():
                issues[col] = f"{np.isinf(X[col]).sum()} infinite values"
        
        is_valid = len(missing) == 0 and len(issues) == 0
        
        return is_valid, missing, issues
    
    def detect_feature_drift(
        self,
        X_train: pd.DataFrame,
        X_live: pd.DataFrame,
        threshold: float = 0.1
    ) -> Dict[str, Dict[str, float]]:
        """
        Detect feature distribution drift between training and live data.
        
        Args:
            X_train: Training data features
            X_live: Live data features
            threshold: Alert if drift > this percentage
            
        Returns:
            Dictionary with drift metrics for each numeric feature
        """
        drift_report = {}
        
        numeric_cols = X_train.select_dtypes(include=[np.number]).columns
        
        for col in numeric_cols:
            if col not in X_live.columns:
                continue
            
            train_mean = X_train[col].mean()
            train_std = X_train[col].std()
            
            live_mean = X_live[col].mean()
            live_std = X_live[col].std()
            
            if train_mean != 0:
                mean_drift = abs((live_mean - train_mean) / train_mean)
            else:
                mean_drift = abs(live_mean - train_mean)
            
            if train_std != 0:
                std_drift = abs((live_std - train_std) / train_std)
            else:
                std_drift = 0
            
            max_drift = max(mean_drift, std_drift)
            
            drift_report[col] = {
                "mean_drift": mean_drift,
                "std_drift": std_drift,
                "max_drift": max_drift,
                "alert": max_drift > threshold,
                "train_mean": train_mean,
                "train_std": train_std,
                "live_mean": live_mean,
                "live_std": live_std,
            }
        
        return drift_report
    
    def check_data_leakage(
        self,
        df: pd.DataFrame,
        label_col: str = "Target",
        entry_offset_bars: int = 1
    ) -> Tuple[bool, List[str]]:
        """
        Detect potential data leakage issues.
        
        Data leakage occurs when:
        1. Features use future data
        2. Entry price includes close from same bar (instead of next open)
        3. Labels are based on same bar data
        
        Args:
            df: DataFrame with features and labels
            label_col: Name of label column
            entry_offset_bars: How many bars entry is offset (should be 1 for next open)
            
        Returns:
            (has_leakage, list_of_issues)
        """
        issues = []
        
        # Check 1: Entry offset
        if entry_offset_bars < 1:
            issues.append(
                f"Entry offset < 1 ({entry_offset_bars}), possible look-ahead bias"
            )
        
        # Check 2: Feature correlation with labels
        if label_col in df.columns:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            numeric_cols = [c for c in numeric_cols if c != label_col]
            
            if len(numeric_cols) > 0:
                correlations = df[numeric_cols].corrwith(df[label_col])
                
                # Perfect or near-perfect correlation suggests leakage
                high_corr = correlations[abs(correlations) > 0.9]
                if len(high_corr) > 0:
                    for col in high_corr.index:
                        issues.append(
                            f"Feature {col} has suspiciously high correlation "
                            f"with labels ({correlations[col]:.3f}), possible leakage"
                        )
        
        # Check 3: Time ordering
        if "date" in df.columns or isinstance(df.index, pd.DatetimeIndex):
            # Check if data is properly sorted
            if isinstance(df.index, pd.DatetimeIndex):
                if not df.index.is_monotonic_increasing:
                    issues.append("DataFrame is not sorted by date (temporal integrity issue)")
        
        has_leakage = len(issues) > 0
        return has_leakage, issues
    
    def print_data_summary(self, bars: pd.DataFrame) -> None:
        """
        Print a summary of data characteristics.
        """
        print(f"\n{'='*60}")
        print(f"DATA SUMMARY")
        print(f"{'='*60}")
        print(f"Rows: {len(bars)}")
        print(f"Columns: {len(bars.columns)}")
        print(f"Date range: {bars.index[0]} to {bars.index[-1]}")
        print(f"\nColumn info:")
        for col in bars.columns:
            non_null = bars[col].notna().sum()
            null_pct = (1 - non_null / len(bars)) * 100
            print(f"  {col}: {bars[col].dtype}, {non_null}/{len(bars)} non-null ({null_pct:.1f}% null)")
        
        # Summary statistics for numeric columns
        numeric = bars.select_dtypes(include=[np.number])
        if len(numeric) > 0:
            print(f"\nNumeric statistics:")
            print(numeric.describe().to_string())
        
        print(f"\n{'='*60}\n")


def validate_unified_parameters(
    training_params: TradingParameters,
    live_bot_config: Dict[str, Any],
) -> Tuple[bool, List[str]]:
    """
    Validate that training and live bot use compatible parameters.
    
    Args:
        training_params: TradingParameters from model training
        live_bot_config: Live bot configuration dictionary
        
    Returns:
        (is_compatible, list_of_mismatches)
    """
    mismatches = []
    
    # Extract key parameters from bot config
    bot_params = TradingParameters.from_live_bot_config(live_bot_config)
    
    # Check key mismatches
    if training_params.barrier_mode != bot_params.barrier_mode:
        mismatches.append(
            f"barrier_mode mismatch: training={training_params.barrier_mode}, "
            f"bot={bot_params.barrier_mode}"
        )
    
    if training_params.target_pct != bot_params.target_pct:
        mismatches.append(
            f"target_pct mismatch: training={training_params.target_pct}, "
            f"bot={bot_params.target_pct}"
        )
    
    if training_params.stop_loss_pct != bot_params.stop_loss_pct:
        mismatches.append(
            f"stop_loss_pct mismatch: training={training_params.stop_loss_pct}, "
            f"bot={bot_params.stop_loss_pct}"
        )
    
    if training_params.look_forward_days != bot_params.look_forward_days:
        mismatches.append(
            f"look_forward_days mismatch: training={training_params.look_forward_days}, "
            f"bot={bot_params.look_forward_days}"
        )
    
    is_compatible = len(mismatches) == 0
    return is_compatible, mismatches
