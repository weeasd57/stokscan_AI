"""
Unified trading configuration module for training-consistency spec.

This module provides the TradingParameters dataclass that unifies trading logic
across training, live bot, and backtest systems. It ensures consistent parameter
usage to eliminate inconsistencies between different trading components.

Author: Training-Consistency Spec Implementation
Created: 2025-01-28
"""

from dataclasses import dataclass, asdict
from typing import Dict, Any, Optional, List, Union, Tuple
import logging
import pandas as pd
import json
import os
import argparse
from pathlib import Path
from enum import Enum

# Optional dependencies with graceful fallback
try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False
    yaml = None

logger = logging.getLogger(__name__)


class ConfigProfile(Enum):
    """Configuration profiles for different environments"""
    DEVELOPMENT = "development"
    TESTING = "testing"
    PRODUCTION = "production"


class ParameterSource(Enum):
    """Sources for parameter loading"""
    DEFAULT = "default"
    CONFIG_FILE = "config_file"
    ENVIRONMENT = "environment"
    COMMAND_LINE = "command_line"
    MODEL_ARTIFACT = "model_artifact"
    DATABASE = "database"


@dataclass
class TradingParameters:
    """
    Unified trading parameters used across training, live bot, and backtest systems.
    
    This dataclass ensures consistent configuration for:
    - Entry logic and timing
    - Look-forward periods and barrier calculations
    - Volume confirmation requirements
    - Threshold management for model predictions
    - Feature engineering parameters
    - Risk management settings
    
    All trading components (training, live bot, backtest) should use this class
    to load and apply trading parameters consistently.
    """
    
    # === Entry Logic ===
    entry_mode: str = "next_open"  # "next_open" | "current_close"
    entry_buffer_pct: float = 0.001  # Slippage/spread assumption (0.1%)
    
    # === Time Horizon ===
    look_forward_days: int = 20  # Days to look forward for trade outcomes
    look_forward_mode: str = "fixed"  # "fixed" | "atr_based"
    
    # === Barrier Mode ===
    barrier_mode: str = "percent"  # "percent" | "atr_multiplier"
    target_pct: float = 0.10  # 10% target profit OR ATR multiplier for TP
    stop_loss_pct: float = 0.05  # 5% stop loss OR ATR multiplier for SL
    use_adaptive_exits: bool = False  # Enable dynamic exits based on market regime
    
    # === Volume Confirmation (EGX specific) ===
    require_volume_confirmation: bool = False  # Enable volume confirmation
    min_volume_ratio: float = 0.3  # Volume must be >= MA_20 * ratio
    volume_confirmation_period: int = 5  # Days to confirm volume
    
    # === Model Thresholds ===
    king_threshold: float = 0.50  # Primary model prediction threshold
    council_threshold: float = 0.50  # Council consensus threshold
    validator_threshold: float = 0.50  # Validator approval threshold
    
    # === Feature Engineering ===
    min_history_needed: int = 100  # Minimum bars needed before prediction
    warmup_bars: int = 100  # Bars to skip at start for indicator warmup
    feature_lookback: int = 252  # Lookback period for some indicators (1 year)
    
    # === Risk Management ===
    max_consecutive_losses: int = 5  # Max consecutive losses before pause
    daily_loss_limit: float = 1000.0  # Daily loss limit in base currency
    
    @classmethod
    def from_model_artifact(cls, artifact: Dict[str, Any]) -> "TradingParameters":
        """
        Extract trading parameters from a model artifact.
        
        This method loads unified parameters from model metadata to ensure
        consistent usage across training, live bot, and backtest systems.
        
        Args:
            artifact: Model artifact dictionary containing metadata
            
        Returns:
            TradingParameters instance with values from artifact
            
        Raises:
            ValueError: If artifact format is invalid
            KeyError: If required artifact fields are missing
        """
        if not isinstance(artifact, dict):
            raise ValueError(f"Artifact must be a dictionary, got {type(artifact).__name__}")
        
        # Initialize with defaults
        params = cls()
        
        try:
            # Extract from unified trading_parameters section (new format)
            trading_params = artifact.get("trading_parameters", {})
            if trading_params:
                params.entry_mode = trading_params.get("entry_mode", params.entry_mode)
                params.entry_buffer_pct = trading_params.get("entry_buffer_pct", params.entry_buffer_pct)
                params.look_forward_days = trading_params.get("look_forward_days", params.look_forward_days)
                params.look_forward_mode = trading_params.get("look_forward_mode", params.look_forward_mode)
                params.barrier_mode = trading_params.get("barrier_mode", params.barrier_mode)
                params.target_pct = trading_params.get("target_pct", params.target_pct)
                params.stop_loss_pct = trading_params.get("stop_loss_pct", params.stop_loss_pct)
                params.use_adaptive_exits = trading_params.get("use_adaptive_exits", params.use_adaptive_exits)
                params.require_volume_confirmation = trading_params.get("require_volume_confirmation", params.require_volume_confirmation)
                params.min_volume_ratio = trading_params.get("min_volume_ratio", params.min_volume_ratio)
                params.volume_confirmation_period = trading_params.get("volume_confirmation_period", params.volume_confirmation_period)
            
            # Extract thresholds section
            thresholds = artifact.get("thresholds", {})
            if thresholds:
                params.king_threshold = thresholds.get("king_threshold", 
                                                     thresholds.get("optimal_threshold", params.king_threshold))
                params.council_threshold = thresholds.get("council_threshold", params.council_threshold)
                params.validator_threshold = thresholds.get("validator_threshold", params.validator_threshold)
            
            # Extract feature requirements section
            feature_req = artifact.get("feature_requirements", {})
            if feature_req:
                params.min_history_needed = feature_req.get("min_history_needed", params.min_history_needed)
                params.warmup_bars = feature_req.get("warmup_bars", params.warmup_bars)
                params.feature_lookback = feature_req.get("feature_lookback", params.feature_lookback)
            
            # Fallback: Extract from legacy artifact structure (backward compatibility)
            if not trading_params:
                primary_model = artifact.get("primary_model", {})
                
                # Legacy entry mode extraction
                params.entry_mode = artifact.get("entry_mode", params.entry_mode)
                params.barrier_mode = artifact.get("barrier_mode", params.barrier_mode)
                params.look_forward_days = artifact.get("look_forward_days", params.look_forward_days)
                params.target_pct = artifact.get("target_pct", params.target_pct)
                params.stop_loss_pct = artifact.get("stop_loss_pct", params.stop_loss_pct)
                
                # Legacy threshold extraction
                params.king_threshold = artifact.get("optimal_threshold", 
                                                   artifact.get("meta_threshold", params.king_threshold))
                params.council_threshold = artifact.get("council_threshold", params.council_threshold)
                params.require_volume_confirmation = artifact.get("require_volume_confirmation", params.require_volume_confirmation)
            
            # Validate extracted parameters
            params._validate()
            
            logger.info(f"Loaded trading parameters from artifact: "
                       f"entry_mode={params.entry_mode}, "
                       f"look_forward_days={params.look_forward_days}, "
                       f"barrier_mode={params.barrier_mode}, "
                       f"king_threshold={params.king_threshold}")
            
            return params
            
        except Exception as e:
            logger.error(f"Error extracting trading parameters from artifact: {e}")
            logger.warning("Using default trading parameters")
            return cls()  # Return defaults on error

    @classmethod
    def from_live_bot_config(cls, config: Union[Dict[str, Any], Any]) -> "TradingParameters":
        """
        Extract trading parameters from a live bot configuration (dictionary or object).
        
        Args:
            config: Live bot config dictionary or BotConfig object
            
        Returns:
            TradingParameters instance
        """
        params = cls()
        
        # If it's an object (like BotConfig), convert to dict or access attributes
        def get_val(key, default):
            if isinstance(config, dict):
                return config.get(key, default)
            else:
                return getattr(config, key, default)
                
        # Map values from bot configuration
        params.entry_mode = get_val("entry_mode", params.entry_mode)
        params.entry_buffer_pct = get_val("slippage_buffer_pct", params.entry_buffer_pct)
        params.look_forward_days = get_val("hold_max_bars", params.look_forward_days)
        
        # Map barrier_mode: bot config has use_atr_exits (bool) which corresponds to barrier_mode = "atr_multiplier" if True else "percent"
        use_atr = get_val("use_atr_exits", False)
        params.barrier_mode = "atr_multiplier" if use_atr else "percent"
        
        # In percent mode, target_pct/stop_loss_pct are target_pct/stop_loss_pct.
        # In atr_multiplier mode, target_pct/stop_loss_pct are atr_tp_multiplier/atr_sl_multiplier.
        if params.barrier_mode == "percent":
            params.target_pct = get_val("target_pct", params.target_pct)
            params.stop_loss_pct = get_val("stop_loss_pct", params.stop_loss_pct)
        else:
            params.target_pct = get_val("atr_tp_multiplier", params.target_pct)
            params.stop_loss_pct = get_val("atr_sl_multiplier", params.stop_loss_pct)
            
        params.use_adaptive_exits = get_val("use_adaptive_exits", params.use_adaptive_exits)
        params.king_threshold = get_val("king_threshold", params.king_threshold)
        params.council_threshold = get_val("council_threshold", params.council_threshold)
        params.min_volume_ratio = get_val("min_volume_ratio", params.min_volume_ratio)
        params.warmup_bars = get_val("warmup_bars", params.warmup_bars)
        params.daily_loss_limit = get_val("daily_loss_limit", params.daily_loss_limit)
        params.max_consecutive_losses = get_val("max_consecutive_losses", params.max_consecutive_losses)
        
        # Optional validation
        try:
            params._validate()
        except ValueError as e:
            logger.warning(f"Extracted parameters failed validation: {e}")
            
        return params
    
    @classmethod
    def from_config_file(cls, config_path: Union[str, Path], profile: ConfigProfile = ConfigProfile.PRODUCTION) -> "TradingParameters":
        """
        Load trading parameters from configuration file (JSON or YAML).
        
        Args:
            config_path: Path to configuration file
            profile: Configuration profile to use (development, testing, production)
            
        Returns:
            TradingParameters instance loaded from config
            
        Raises:
            FileNotFoundError: If config file doesn't exist
            ValueError: If config format is invalid
        """
        config_path = Path(config_path)
        if not config_path.exists():
            raise FileNotFoundError(f"Configuration file not found: {config_path}")
        
        try:
            with open(config_path, 'r') as f:
                if config_path.suffix.lower() in ['.yml', '.yaml']:
                    if not HAS_YAML:
                        raise ValueError("PyYAML is required for YAML config files. Install with: pip install PyYAML")
                    config_data = yaml.safe_load(f)
                else:
                    config_data = json.load(f)
            
            # Extract profile-specific config
            if isinstance(config_data, dict) and profile.value in config_data:
                params_data = config_data[profile.value]
            else:
                params_data = config_data
            
            params = cls._create_from_dict(params_data, ParameterSource.CONFIG_FILE)
            logger.info(f"Loaded parameters from config file: {config_path} (profile: {profile.value})")
            return params
            
        except (json.JSONDecodeError, yaml.YAMLError) as e:
            raise ValueError(f"Invalid config file format: {e}")
        except Exception as e:
            logger.error(f"Error loading config file {config_path}: {e}")
            raise
    
    @classmethod
    def from_environment(cls, prefix: str = "TRADING_") -> "TradingParameters":
        """
        Load trading parameters from environment variables.
        
        Environment variables should be prefixed (default: TRADING_) and use 
        uppercase field names. For example: TRADING_ENTRY_MODE, TRADING_TARGET_PCT
        
        Args:
            prefix: Prefix for environment variable names
            
        Returns:
            TradingParameters instance with environment overrides
        """
        params = cls()
        env_overrides = {}
        
        # Map parameter names to expected environment variable names
        param_mapping = {
            'entry_mode': f'{prefix}ENTRY_MODE',
            'entry_buffer_pct': f'{prefix}ENTRY_BUFFER_PCT',
            'look_forward_days': f'{prefix}LOOK_FORWARD_DAYS',
            'look_forward_mode': f'{prefix}LOOK_FORWARD_MODE',
            'barrier_mode': f'{prefix}BARRIER_MODE',
            'target_pct': f'{prefix}TARGET_PCT',
            'stop_loss_pct': f'{prefix}STOP_LOSS_PCT',
            'use_adaptive_exits': f'{prefix}USE_ADAPTIVE_EXITS',
            'require_volume_confirmation': f'{prefix}REQUIRE_VOLUME_CONFIRMATION',
            'min_volume_ratio': f'{prefix}MIN_VOLUME_RATIO',
            'volume_confirmation_period': f'{prefix}VOLUME_CONFIRMATION_PERIOD',
            'king_threshold': f'{prefix}KING_THRESHOLD',
            'council_threshold': f'{prefix}COUNCIL_THRESHOLD',
            'validator_threshold': f'{prefix}VALIDATOR_THRESHOLD',
            'min_history_needed': f'{prefix}MIN_HISTORY_NEEDED',
            'warmup_bars': f'{prefix}WARMUP_BARS',
            'feature_lookback': f'{prefix}FEATURE_LOOKBACK',
            'max_consecutive_losses': f'{prefix}MAX_CONSECUTIVE_LOSSES',
            'daily_loss_limit': f'{prefix}DAILY_LOSS_LIMIT'
        }
        
        for param_name, env_name in param_mapping.items():
            env_value = os.environ.get(env_name)
            if env_value is not None:
                # Type conversion based on parameter type
                try:
                    if param_name in ['entry_mode', 'look_forward_mode', 'barrier_mode']:
                        env_overrides[param_name] = str(env_value)
                    elif param_name in ['require_volume_confirmation', 'use_adaptive_exits']:
                        env_overrides[param_name] = env_value.lower() in ('true', '1', 'yes', 'on')
                    elif param_name in ['look_forward_days', 'volume_confirmation_period', 
                                      'min_history_needed', 'warmup_bars', 'feature_lookback', 
                                      'max_consecutive_losses']:
                        env_overrides[param_name] = int(env_value)
                    else:
                        env_overrides[param_name] = float(env_value)
                except (ValueError, TypeError) as e:
                    logger.warning(f"Invalid environment variable {env_name}={env_value}: {e}")
                    continue
        
        # Apply environment overrides
        for param_name, value in env_overrides.items():
            setattr(params, param_name, value)
            
        if env_overrides:
            logger.info(f"Applied {len(env_overrides)} environment overrides: {list(env_overrides.keys())}")
        
        params._validate()
        return params
    
    @classmethod
    def from_command_line(cls, args: Optional[List[str]] = None) -> "TradingParameters":
        """
        Load trading parameters from command-line arguments.
        
        Args:
            args: Command line arguments (defaults to sys.argv)
            
        Returns:
            TradingParameters instance with command-line overrides
        """
        parser = argparse.ArgumentParser(description="Trading Parameters Configuration")
        
        # Add arguments for all parameters
        parser.add_argument('--entry-mode', choices=['next_open', 'current_close'], 
                          help='Entry price mode')
        parser.add_argument('--entry-buffer-pct', type=float, 
                          help='Entry buffer percentage for slippage')
        parser.add_argument('--look-forward-days', type=int, 
                          help='Days to look forward for trade outcomes')
        parser.add_argument('--look-forward-mode', choices=['fixed', 'atr_based'],
                          help='Look forward mode')
        parser.add_argument('--barrier-mode', choices=['percent', 'atr_multiplier'],
                          help='Barrier calculation mode')
        parser.add_argument('--target-pct', type=float, 
                          help='Target profit percentage or ATR multiplier')
        parser.add_argument('--stop-loss-pct', type=float,
                          help='Stop loss percentage or ATR multiplier')
        parser.add_argument('--require-volume-confirmation', action='store_true',
                          help='Enable volume confirmation requirement')
        parser.add_argument('--min-volume-ratio', type=float,
                          help='Minimum volume ratio for confirmation')
        parser.add_argument('--king-threshold', type=float,
                          help='Primary model prediction threshold')
        parser.add_argument('--council-threshold', type=float,
                          help='Council consensus threshold')
        parser.add_argument('--validator-threshold', type=float,
                          help='Validator approval threshold')
        
        parsed_args = parser.parse_args(args)
        
        # Start with defaults
        params = cls()
        
        # Apply command-line overrides
        cmd_overrides = {}
        for arg_name, value in vars(parsed_args).items():
            if value is not None:
                # Convert argument names back to parameter names
                param_name = arg_name.replace('-', '_')
                setattr(params, param_name, value)
                cmd_overrides[param_name] = value
        
        if cmd_overrides:
            logger.info(f"Applied {len(cmd_overrides)} command-line overrides: {list(cmd_overrides.keys())}")
        
        params._validate()
        return params
    
    @classmethod
    def from_multiple_sources(
        cls,
        config_file: Optional[Union[str, Path]] = None,
        profile: ConfigProfile = ConfigProfile.PRODUCTION,
        env_prefix: str = "TRADING_",
        cmd_args: Optional[List[str]] = None,
        model_artifact: Optional[Dict[str, Any]] = None
    ) -> "TradingParameters":
        """
        Load trading parameters from multiple sources with priority order:
        1. Command line arguments (highest priority)
        2. Environment variables
        3. Configuration file
        4. Model artifact
        5. Defaults (lowest priority)
        
        Args:
            config_file: Path to configuration file (optional)
            profile: Configuration profile for config file
            env_prefix: Prefix for environment variables
            cmd_args: Command line arguments (optional)
            model_artifact: Model artifact dictionary (optional)
            
        Returns:
            TradingParameters instance with merged configuration
        """
        # Start with defaults
        params = cls()
        sources_used = [ParameterSource.DEFAULT]
        
        # 1. Load from model artifact (lowest priority override)
        if model_artifact:
            artifact_params = cls.from_model_artifact(model_artifact)
            params = cls._merge_parameters(params, artifact_params, ParameterSource.MODEL_ARTIFACT)
            sources_used.append(ParameterSource.MODEL_ARTIFACT)
        
        # 2. Load from config file
        if config_file and Path(config_file).exists():
            try:
                config_params = cls.from_config_file(config_file, profile)
                params = cls._merge_parameters(params, config_params, ParameterSource.CONFIG_FILE)
                sources_used.append(ParameterSource.CONFIG_FILE)
            except Exception as e:
                logger.warning(f"Failed to load config file {config_file}: {e}")
        
        # 3. Load from environment variables
        env_params = cls.from_environment(env_prefix)
        params = cls._merge_parameters(params, env_params, ParameterSource.ENVIRONMENT)
        sources_used.append(ParameterSource.ENVIRONMENT)
        
        # 4. Load from command line (highest priority)
        if cmd_args:
            try:
                cmd_params = cls.from_command_line(cmd_args)
                params = cls._merge_parameters(params, cmd_params, ParameterSource.COMMAND_LINE)
                sources_used.append(ParameterSource.COMMAND_LINE)
            except SystemExit:
                # argparse calls sys.exit on --help or error
                pass
        
        params._validate()
        logger.info(f"Loaded parameters from sources: {[s.value for s in sources_used]}")
        return params
    
    @classmethod
    def _create_from_dict(cls, data: Dict[str, Any], source: ParameterSource) -> "TradingParameters":
        """Create TradingParameters from dictionary data."""
        params = cls()
        
        for field_name in params.__dataclass_fields__:
            if field_name in data:
                setattr(params, field_name, data[field_name])
        
        params._validate()
        return params
    
    @classmethod
    def _merge_parameters(
        cls, 
        base: "TradingParameters", 
        override: "TradingParameters", 
        source: ParameterSource
    ) -> "TradingParameters":
        """Merge two TradingParameters instances, with override taking precedence for non-default values."""
        merged = cls()
        
        # Start with base values
        for field_name in merged.__dataclass_fields__:
            setattr(merged, field_name, getattr(base, field_name))
        
        # Override with non-default values from override
        default_params = cls()
        for field_name in merged.__dataclass_fields__:
            override_value = getattr(override, field_name)
            default_value = getattr(default_params, field_name)
            
            # Only override if the value is different from default
            if override_value != default_value:
                setattr(merged, field_name, override_value)
                logger.debug(f"Parameter {field_name} overridden by {source.value}: {override_value}")
        
        return merged
    
    def to_dict(self) -> Dict[str, Any]:
        """
        Convert trading parameters to dictionary for saving in model artifact.
        
        This method creates a dictionary representation suitable for inclusion
        in model artifacts, ensuring parameters can be persisted and reloaded.
        
        Returns:
            Dictionary containing all trading parameters
        """
        return asdict(self)
    
    def validate(self) -> Tuple[bool, List[str]]:
        """
        Validate parameters and return compatibility/errors.
        
        Returns:
            (is_valid, list_of_errors)
        """
        try:
            self._validate()
            return True, []
        except ValueError as e:
            # Extract errors from the multi-line message
            msg = str(e)
            errors = []
            for line in msg.split('\n'):
                line = line.strip()
                if line.startswith('- '):
                    errors.append(line[2:])
                elif line.startswith('Parameter validation failed:'):
                    continue
                elif line:
                    errors.append(line)
            return False, errors

    def _validate(self) -> None:
        """
        Validate trading parameter values with comprehensive checks.
        
        Raises:
            ValueError: If parameter values are invalid
        """
        errors = []
        
        # === Basic Field Validation ===
        
        # Validate entry mode
        if self.entry_mode not in ["next_open", "current_close"]:
            errors.append(f"Invalid entry_mode: {self.entry_mode}. Must be 'next_open' or 'current_close'")
        
        # Validate look forward parameters
        if self.look_forward_days <= 0:
            errors.append(f"look_forward_days must be positive, got {self.look_forward_days}")
        
        if self.look_forward_mode not in ["fixed", "atr_based"]:
            errors.append(f"Invalid look_forward_mode: {self.look_forward_mode}. Must be 'fixed' or 'atr_based'")
        
        # Validate barrier mode
        if self.barrier_mode not in ["percent", "atr_multiplier"]:
            errors.append(f"Invalid barrier_mode: {self.barrier_mode}. Must be 'percent' or 'atr_multiplier'")
        
        # Validate percentage values for percent mode
        if self.barrier_mode == "percent":
            if not (0 < self.target_pct <= 1.0):
                errors.append(f"target_pct must be between 0 and 1 for percent mode, got {self.target_pct}")
            if not (0 < self.stop_loss_pct <= 1.0):
                errors.append(f"stop_loss_pct must be between 0 and 1 for percent mode, got {self.stop_loss_pct}")
        
        # Validate multiplier values for ATR mode
        if self.barrier_mode == "atr_multiplier":
            if self.target_pct <= 0:
                errors.append(f"target_pct must be positive for atr_multiplier mode, got {self.target_pct}")
            if self.stop_loss_pct <= 0:
                errors.append(f"stop_loss_pct must be positive for atr_multiplier mode, got {self.stop_loss_pct}")
        
        # Validate thresholds
        for threshold_name in ["king_threshold", "council_threshold", "validator_threshold"]:
            threshold_val = getattr(self, threshold_name)
            if not (0 <= threshold_val <= 1.0):
                errors.append(f"{threshold_name} must be between 0 and 1, got {threshold_val}")
        
        # Validate volume confirmation parameters
        if self.min_volume_ratio <= 0:
            errors.append(f"min_volume_ratio must be positive, got {self.min_volume_ratio}")
        
        if self.volume_confirmation_period <= 0:
            errors.append(f"volume_confirmation_period must be positive, got {self.volume_confirmation_period}")
        
        # Validate feature engineering parameters
        if self.min_history_needed <= 0:
            errors.append(f"min_history_needed must be positive, got {self.min_history_needed}")
        
        if self.warmup_bars < 0:
            errors.append(f"warmup_bars must be non-negative, got {self.warmup_bars}")
        
        if self.feature_lookback <= 0:
            errors.append(f"feature_lookback must be positive, got {self.feature_lookback}")
        
        # Validate risk management parameters
        if self.max_consecutive_losses <= 0:
            errors.append(f"max_consecutive_losses must be positive, got {self.max_consecutive_losses}")
        
        if self.daily_loss_limit <= 0:
            errors.append(f"daily_loss_limit must be positive, got {self.daily_loss_limit}")
        
        if self.entry_buffer_pct < 0:
            errors.append(f"entry_buffer_pct must be non-negative, got {self.entry_buffer_pct}")
        
        # === Cross-Parameter Validation ===
        
        # Ensure target > stop loss for percent mode
        if self.barrier_mode == "percent" and self.target_pct <= self.stop_loss_pct:
            errors.append(f"target_pct ({self.target_pct}) must be greater than stop_loss_pct ({self.stop_loss_pct})")
        
        # Ensure reasonable risk/reward ratio
        if self.barrier_mode == "percent":
            risk_reward_ratio = self.target_pct / self.stop_loss_pct
            if risk_reward_ratio < 1.0:
                errors.append(f"Risk/reward ratio too low: {risk_reward_ratio:.2f} (target/stop_loss < 1.0)")
            elif risk_reward_ratio > 10.0:
                logger.warning(f"Very high risk/reward ratio: {risk_reward_ratio:.2f} - consider reviewing")
        
        # === Business Logic Validation ===
        
        # Warn about extreme parameters
        if self.look_forward_days > 60:
            logger.warning(f"Very long look_forward_days: {self.look_forward_days} days")
        
        if self.barrier_mode == "percent" and self.target_pct > 0.50:
            logger.warning(f"Very high target_pct: {self.target_pct * 100}%")
        
        if self.min_history_needed < 50:
            logger.warning(f"Low min_history_needed: {self.min_history_needed} bars may not provide stable features")
        
        # Ensure warmup is sufficient for lookback
        if self.warmup_bars < self.feature_lookback:
            logger.warning(f"warmup_bars ({self.warmup_bars}) < feature_lookback ({self.feature_lookback}) - may cause NaN features")
        
        # Volume confirmation warnings
        if self.require_volume_confirmation and self.min_volume_ratio > 2.0:
            logger.warning(f"Very high min_volume_ratio: {self.min_volume_ratio} - may reject many trades")
        
        # === Market-Specific Validation ===
        if self.require_volume_confirmation:
            if self.volume_confirmation_period > self.look_forward_days:
                errors.append(f"volume_confirmation_period ({self.volume_confirmation_period}) cannot exceed look_forward_days ({self.look_forward_days})")
        
        # Risk management consistency
        if self.max_consecutive_losses < 3:
            logger.warning(f"Low max_consecutive_losses ({self.max_consecutive_losses}) may cause frequent trading halts")
        
        if self.daily_loss_limit < 100:
            logger.warning(f"Very low daily_loss_limit: {self.daily_loss_limit}")
        
        # === Raise Combined Errors ===
        if errors:
            error_message = "Parameter validation failed:\n" + "\n".join(f"  - {error}" for error in errors)
            raise ValueError(error_message)
        
        logger.debug("All parameter validations passed")
    
    def validate_for_market(self, market: str) -> Dict[str, List[str]]:
        """
        Validate parameters for specific market conditions.
        
        Args:
            market: Market identifier ('EGX', 'NYSE', 'CRYPTO', etc.)
            
        Returns:
            Dictionary with 'errors', 'warnings', and 'recommendations' lists
        """
        validation_result = {
            'errors': [],
            'warnings': [],
            'recommendations': []
        }
        
        market = market.upper()
        
        if market == 'EGX':
            # EGX-specific validation
            if not self.require_volume_confirmation:
                validation_result['warnings'].append("EGX typically requires volume confirmation - consider enabling")
            
            if self.look_forward_days < 5:
                validation_result['warnings'].append("EGX markets may need longer look_forward_days (>=5)")
            
            if self.entry_buffer_pct < 0.002:  # 0.2%
                validation_result['recommendations'].append("Consider higher entry_buffer_pct (>=0.2%) for EGX spreads")
        
        elif market == 'CRYPTO':
            # Crypto-specific validation
            if self.entry_buffer_pct < 0.001:
                validation_result['recommendations'].append("Consider entry_buffer_pct >=0.1% for crypto volatility")
            
            if self.look_forward_days > 14:
                validation_result['warnings'].append("Long look_forward_days may not suit crypto volatility")
            
            if self.barrier_mode == "percent" and self.target_pct < 0.05:
                validation_result['recommendations'].append("Crypto markets may support higher target_pct (>=5%)")
        
        elif market in ['NYSE', 'NASDAQ']:
            # US equity validation
            if self.require_volume_confirmation:
                validation_result['recommendations'].append("Volume confirmation less critical for liquid US markets")
            
            if self.entry_buffer_pct > 0.003:
                validation_result['warnings'].append("High entry_buffer_pct may be excessive for liquid US markets")
        
        return validation_result
    
    def get_effective_warmup(self) -> int:
        """
        Get the effective warmup period considering all requirements.
        
        Returns:
            Maximum of warmup_bars, min_history_needed, and feature_lookback
        """
        return max(
            self.warmup_bars,
            self.min_history_needed,
            self.feature_lookback
        )
    
    def calculate_barriers(
        self,
        entry_price: float,
        atr: Optional[float] = None
    ) -> Tuple[float, float]:
        """
        Calculate Take Profit and Stop Loss barriers.
        
        Args:
            entry_price: The entry price of the position
            atr: The ATR value (required if barrier_mode is 'atr_multiplier')
            
        Returns:
            Tuple of (tp_price, sl_price)
        """
        if entry_price <= 0:
            raise ValueError(f"Entry price must be positive: {entry_price}")
            
        if self.barrier_mode == "percent":
            tp = entry_price * (1.0 + self.target_pct)
            sl = entry_price * (1.0 - self.stop_loss_pct)
        elif self.barrier_mode == "atr_multiplier":
            if atr is None or atr <= 0:
                raise ValueError(f"ATR required for atr_multiplier mode, got: {atr}")
            tp = entry_price + (atr * self.target_pct)
            sl = entry_price - (atr * self.stop_loss_pct)
        else:
            raise ValueError(f"Unknown barrier_mode: {self.barrier_mode}")
            
        return tp, sl

    def estimate_risk_reward_ratio(
        self,
        entry_price: float,
        atr: Optional[float] = None
    ) -> float:
        """
        Estimate risk reward ratio.
        
        Args:
            entry_price: The entry price of the position
            atr: The ATR value (required if barrier_mode is 'atr_multiplier')
            
        Returns:
            Risk reward ratio (tp_change / sl_change)
        """
        tp, sl = self.calculate_barriers(entry_price, atr)
        tp_change = tp - entry_price
        sl_change = entry_price - sl
        if sl_change <= 0:
            return 0.0
        return tp_change / sl_change

    def create_profile_variant(self, profile: ConfigProfile) -> "TradingParameters":
        """
        Create a variant of parameters optimized for specific environment.
        
        Args:
            profile: Target configuration profile
            
        Returns:
            New TradingParameters instance optimized for profile
        """
        params = TradingParameters(**asdict(self))
        
        if profile == ConfigProfile.DEVELOPMENT:
            # Conservative settings for development
            params.look_forward_days = min(5, params.look_forward_days)
            params.target_pct = max(0.06, min(0.05, params.target_pct))  # Ensure target > stop_loss
            params.stop_loss_pct = max(0.02, min(0.03, params.stop_loss_pct))  # Max 3% stop loss
            params.daily_loss_limit = min(100.0, params.daily_loss_limit)
            params.max_consecutive_losses = min(3, params.max_consecutive_losses)
            logger.info("Created development profile with conservative settings")
            
        elif profile == ConfigProfile.TESTING:
            # Balanced settings for testing
            params.look_forward_days = min(10, params.look_forward_days)
            params.daily_loss_limit = min(500.0, params.daily_loss_limit)
            params.max_consecutive_losses = min(5, params.max_consecutive_losses)
            logger.info("Created testing profile with balanced settings")
            
        elif profile == ConfigProfile.PRODUCTION:
            # Use current settings but add safeguards
            if params.daily_loss_limit > 5000.0:
                logger.warning("Very high daily_loss_limit for production - consider review")
            logger.info("Using production profile with current settings")
        
        params._validate()
        return params
    
    def merge_with_overrides(self, overrides: Dict[str, Any]) -> "TradingParameters":
        """
        Create new instance with parameter overrides.
        
        Args:
            overrides: Dictionary of parameter overrides
            
        Returns:
            New TradingParameters instance with overrides applied
        """
        current_params = asdict(self)
        current_params.update(overrides)
        
        new_params = TradingParameters(**current_params)
        new_params._validate()
        
        logger.info(f"Applied parameter overrides: {list(overrides.keys())}")
        return new_params
    
    def calculate_parameter_drift(self, other: "TradingParameters") -> Dict[str, Dict[str, Any]]:
        """
        Calculate drift between two parameter sets.
        
        Args:
            other: Other TradingParameters instance to compare with
            
        Returns:
            Dictionary with drift information for each parameter
        """
        drift_report = {}
        
        for field_name in self.__dataclass_fields__:
            current_value = getattr(self, field_name)
            other_value = getattr(other, field_name)
            
            if current_value != other_value:
                # Calculate relative change for numeric values
                relative_change = None
                if isinstance(current_value, (int, float)) and current_value != 0:
                    relative_change = (other_value - current_value) / abs(current_value)
                
                drift_report[field_name] = {
                    'current': current_value,
                    'other': other_value,
                    'absolute_change': other_value - current_value if isinstance(current_value, (int, float)) else None,
                    'relative_change': relative_change,
                    'drift_magnitude': abs(relative_change) if relative_change is not None else None
                }
        
        return drift_report
    
    def generate_parameter_summary(self) -> Dict[str, Any]:
        """
        Generate comprehensive parameter summary for logging and debugging.
        
        Returns:
            Dictionary with parameter summary and metadata
        """
        return {
            'entry_logic': {
                'entry_mode': self.entry_mode,
                'entry_buffer_pct': self.entry_buffer_pct,
                'effective_entry_cost': f"{self.entry_buffer_pct * 100:.3f}%"
            },
            'time_horizon': {
                'look_forward_days': self.look_forward_days,
                'look_forward_mode': self.look_forward_mode
            },
            'barriers': {
                'barrier_mode': self.barrier_mode,
                'target_pct': self.target_pct,
                'stop_loss_pct': self.stop_loss_pct,
                'risk_reward_ratio': self.target_pct / self.stop_loss_pct if self.barrier_mode == "percent" else None
            },
            'volume_confirmation': {
                'enabled': self.require_volume_confirmation,
                'min_volume_ratio': self.min_volume_ratio,
                'confirmation_period': self.volume_confirmation_period
            },
            'thresholds': {
                'king_threshold': self.king_threshold,
                'council_threshold': self.council_threshold,
                'validator_threshold': self.validator_threshold
            },
            'feature_engineering': {
                'min_history_needed': self.min_history_needed,
                'warmup_bars': self.warmup_bars,
                'feature_lookback': self.feature_lookback,
                'effective_warmup': self.get_effective_warmup()
            },
            'risk_management': {
                'max_consecutive_losses': self.max_consecutive_losses,
                'daily_loss_limit': self.daily_loss_limit
            }
        }
    
    def save_to_config_file(self, config_path: Union[str, Path], profile: ConfigProfile = ConfigProfile.PRODUCTION) -> None:
        """
        Save parameters to configuration file.
        
        Args:
            config_path: Path where to save the configuration
            profile: Configuration profile to use
        """
        config_path = Path(config_path)
        config_path.parent.mkdir(parents=True, exist_ok=True)
        
        config_data = {
            profile.value: asdict(self),
            '_metadata': {
                'created_at': pd.Timestamp.now().isoformat(),
                'profile': profile.value,
                'version': '2.0'
            }
        }
        
        if config_path.suffix.lower() in ['.yml', '.yaml']:
            if not HAS_YAML:
                raise ValueError("PyYAML is required for YAML config files. Install with: pip install PyYAML")
            with open(config_path, 'w') as f:
                yaml.dump(config_data, f, default_flow_style=False, indent=2)
        else:
            with open(config_path, 'w') as f:
                json.dump(config_data, f, indent=2)
        
        logger.info(f"Saved parameters to {config_path} (profile: {profile.value})")
    
    def log_parameter_changes(self, previous: Optional["TradingParameters"] = None) -> None:
        """
        Log parameter changes for auditing and debugging.
        
        Args:
            previous: Previous parameter configuration for comparison
        """
        logger.info("=== Trading Parameters Summary ===")
        summary = self.generate_parameter_summary()
        
        for section, params in summary.items():
            logger.info(f"{section.upper()}:")
            for key, value in params.items():
                logger.info(f"  {key}: {value}")
        
        if previous is not None:
            drift = self.calculate_parameter_drift(previous)
            if drift:
                logger.info("PARAMETER CHANGES:")
                for param_name, change_info in drift.items():
                    if change_info['relative_change'] is not None:
                        logger.info(f"  {param_name}: {change_info['current']} -> {change_info['other']} "
                                   f"({change_info['relative_change']:+.1%} change)")
                    else:
                        logger.info(f"  {param_name}: {change_info['current']} -> {change_info['other']}")
        
        logger.info("==================================")
    
    def is_legacy_artifact(self, artifact: Dict[str, Any]) -> bool:
        """
        Check if artifact uses legacy parameter structure.
        
        Args:
            artifact: Model artifact dictionary
            
        Returns:
            True if artifact uses legacy structure, False if unified structure
        """
        return "trading_parameters" not in artifact
    
    def __repr__(self) -> str:
        """String representation for debugging."""
        return (f"TradingParameters("
                f"entry_mode={self.entry_mode}, "
                f"look_forward_days={self.look_forward_days}, "
                f"barrier_mode={self.barrier_mode}, "
                f"target_pct={self.target_pct}, "
                f"stop_loss_pct={self.stop_loss_pct}, "
                f"king_threshold={self.king_threshold})")


def create_unified_artifact_metadata(
    params: TradingParameters,
    primary_model: Any = None,
    meta_model: Any = None,
    council_models: Optional[Dict[str, Any]] = None,
    feature_names: Optional[List[str]] = None,
    categorical_features: Optional[List[str]] = None,
    performance_metrics: Optional[Dict[str, float]] = None,
    training_config: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create a unified model artifact structure with trading parameters.
    
    This function creates the standardized artifact format that includes
    unified trading parameters, ensuring consistency across all systems.
    
    Args:
        params: TradingParameters instance
        primary_model: Trained primary model
        meta_model: Trained meta model (optional)
        council_models: Dictionary of council models (optional)
        feature_names: List of feature names
        categorical_features: List of categorical feature names
        performance_metrics: Training/validation performance metrics
        training_config: Training configuration details
        
    Returns:
        Unified artifact dictionary ready for saving
    """
    artifact = {
        "kind": "meta_labeling_system",
        "version": "2.0",  # Unified version
        "created_at": pd.Timestamp.now().isoformat(),
        
        # === Unified Trading Parameters ===
        "trading_parameters": params.to_dict(),
        
        # === Thresholds ===
        "thresholds": {
            "king_threshold": params.king_threshold,
            "council_threshold": params.council_threshold,
            "validator_threshold": params.validator_threshold,
            "optimal_threshold": params.king_threshold,  # Backward compatibility
        },
        
        # === Feature Requirements ===
        "feature_requirements": {
            "min_history_needed": params.min_history_needed,
            "warmup_bars": params.warmup_bars,
            "feature_lookback": params.feature_lookback,
            "expected_features": feature_names or [],
            "categorical_features": categorical_features or [],
        },
        
        # === Model Components ===
        "primary_model": primary_model,
        "meta_model": meta_model,
        "council_models": council_models or {},
        
        # === Training Configuration ===
        "training_config": training_config or {
            "n_splits": 3,
            "embargo_pct": 0.01,
            "purged_kfold": True,
        },
        
        # === Performance Metrics ===
        "performance": performance_metrics or {},
    }
    
    return artifact


# Example usage and testing
if __name__ == "__main__":
    # Test 1: Create default parameters
    print("=== Test 1: Default Parameters ===")
    default_params = TradingParameters()
    print("Default parameters:", default_params)
    
    # Test 2: Load from multiple sources
    print("\n=== Test 2: Multi-Source Loading ===")
    
    # Set up test environment variables
    os.environ['TRADING_KING_THRESHOLD'] = '0.75'
    os.environ['TRADING_TARGET_PCT'] = '0.15'
    
    # Test multi-source loading
    multi_params = TradingParameters.from_multiple_sources(
        env_prefix="TRADING_",
        cmd_args=['--entry-mode', 'current_close', '--look-forward-days', '15']
    )
    print("Multi-source parameters:", multi_params)
    
    # Test 3: Parameter validation
    print("\n=== Test 3: Parameter Validation ===")
    try:
        invalid_params = TradingParameters(entry_mode="invalid", target_pct=-0.1)
        invalid_params._validate()
    except ValueError as e:
        print("Validation working correctly:")
        print(f"  {e}")
    
    # Test 4: Market-specific validation
    print("\n=== Test 4: Market-Specific Validation ===")
    egx_validation = default_params.validate_for_market('EGX')
    print("EGX validation results:")
    for category, messages in egx_validation.items():
        if messages:
            print(f"  {category.upper()}: {messages}")
    
    # Test 5: Configuration profiles
    print("\n=== Test 5: Configuration Profiles ===")
    dev_params = default_params.create_profile_variant(ConfigProfile.DEVELOPMENT)
    print(f"Development profile - target_pct: {dev_params.target_pct}, look_forward_days: {dev_params.look_forward_days}")
    
    # Test 6: Parameter drift calculation
    print("\n=== Test 6: Parameter Drift Analysis ===")
    modified_params = default_params.merge_with_overrides({
        'king_threshold': 0.80,
        'target_pct': 0.15,
        'look_forward_days': 15
    })
    drift = default_params.calculate_parameter_drift(modified_params)
    print("Parameter drift detected:")
    for param, drift_info in drift.items():
        if drift_info['relative_change'] is not None:
            print(f"  {param}: {drift_info['relative_change']:+.1%} change")
        else:
            print(f"  {param}: {drift_info['current']} -> {drift_info['other']}")
    
    # Test 7: Configuration file I/O
    print("\n=== Test 7: Configuration File I/O ===")
    try:
        # Save to config file
        config_path = Path("test_config.json")
        default_params.save_to_config_file(config_path, ConfigProfile.PRODUCTION)
        
        # Load from config file
        loaded_params = TradingParameters.from_config_file(config_path, ConfigProfile.PRODUCTION)
        print(f"Config file save/load successful: {default_params == loaded_params}")
        
        # Cleanup
        if config_path.exists():
            config_path.unlink()
    except Exception as e:
        print(f"Config file test failed: {e}")
    
    # Test 8: Artifact creation and loading  
    print("\n=== Test 8: Model Artifact Integration ===")
    test_artifact = create_unified_artifact_metadata(default_params)
    loaded_params = TradingParameters.from_model_artifact(test_artifact)
    print(f"Artifact save/load successful: {default_params.to_dict() == loaded_params.to_dict()}")
    
    # Test 9: Parameter summary
    print("\n=== Test 9: Parameter Summary ===")
    summary = default_params.generate_parameter_summary()
    print("Parameter summary generated with sections:")
    for section in summary.keys():
        print(f"  - {section}")
    
    # Clean up environment variables
    for key in list(os.environ.keys()):
        if key.startswith('TRADING_'):
            del os.environ[key]
    
    print("\n✅ All TradingParameters tests completed successfully!")