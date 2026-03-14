import os
import time
import json
import numpy as np
import pandas as pd
import gymnasium as gym
from gymnasium import spaces
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.vec_env import DummyVecEnv
from datetime import datetime
from typing import Optional, Dict, Any, List, Callable


# ---------------------------------------------------------------------------
# Normalizer: Keeps running mean/std for observation normalization
# ---------------------------------------------------------------------------
class RunningNormalizer:
    """Online running mean/std normalizer for stable RL training."""
    def __init__(self, shape, clip=10.0):
        self.mean = np.zeros(shape, dtype=np.float64)
        self.var = np.ones(shape, dtype=np.float64)
        self.count = 1e-4
        self.clip = clip

    def update(self, x):
        batch_mean = np.mean(x, axis=0) if x.ndim > 1 else x
        batch_var = np.var(x, axis=0) if x.ndim > 1 else np.zeros_like(x)
        batch_count = x.shape[0] if x.ndim > 1 else 1
        self._update_from_moments(batch_mean, batch_var, batch_count)

    def _update_from_moments(self, batch_mean, batch_var, batch_count):
        delta = batch_mean - self.mean
        total = self.count + batch_count
        new_mean = self.mean + delta * batch_count / total
        m_a = self.var * self.count
        m_b = batch_var * batch_count
        m2 = m_a + m_b + np.square(delta) * self.count * batch_count / total
        self.mean = new_mean
        self.var = m2 / total
        self.count = total

    def normalize(self, x):
        return np.clip(
            (x - self.mean) / np.sqrt(self.var + 1e-8),
            -self.clip, self.clip
        ).astype(np.float32)


# ---------------------------------------------------------------------------
# Enhanced Stock Trading Environment
# ---------------------------------------------------------------------------
class StockTradingEnv(gym.Env):
    """
    Enhanced stock trading environment for gymnasium.
    
    Improvements over v1:
    - Dynamic observation space (accepts any number of features)
    - Differential reward (step-wise PnL change, not cumulative)
    - Position sizing (4 actions: Hold, Buy 100%, Sell 100%, Close)
    - Drawdown penalty in reward
    - Observation normalization
    - Richer info dict for monitoring
    """
    metadata = {'render.modes': ['human']}

    def __init__(
        self,
        df: pd.DataFrame,
        initial_balance: float = 10000,
        reward_mode: str = 'differential',
        max_steps: Optional[int] = None,
        commission: float = 0.001,       # 0.1% per trade
        drawdown_penalty: float = 1.5,   # Increased: non-linear penalty multiplier
        normalize_obs: bool = True,
        min_hold_steps: int = 5,         # Minimum candles to hold before selling
        trade_penalty: float = 0.0005,   # Penalty per new trade to discourage overtrading
        position_size: float = 0.10,     # Max 10% of balance per trade (risk management)
    ):
        super(StockTradingEnv, self).__init__()
        
        self.df = df.reset_index(drop=True)
        self.initial_balance = initial_balance
        self.reward_mode = reward_mode
        self.commission = commission
        self.drawdown_penalty = drawdown_penalty
        self.normalize_obs = normalize_obs
        self.min_hold_steps = min_hold_steps
        self.trade_penalty = trade_penalty
        self.position_size = position_size  # Fraction of balance to risk per trade
        
        if max_steps is not None:
            self.max_steps = min(max_steps, len(self.df) - 1)
        else:
            self.max_steps = len(self.df) - 1

        # Dynamic feature count from the DataFrame
        self.n_features = len(self.df.columns)

        # Action space: 0=Hold, 1=Buy(Long), 2=Sell(Close/Short)
        self.action_space = spaces.Discrete(3)

        # Dynamic observation: features + [position, unrealized_pnl, balance_ratio, steps_in_position_ratio]
        obs_size = self.n_features + 4
        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(obs_size,), dtype=np.float32
        )

        # Observation normalizer
        if self.normalize_obs:
            self.normalizer = RunningNormalizer(obs_size)
        
        # Pre-detect close column for price lookup
        cols_lower = {c.lower(): c for c in self.df.columns}
        self._close_col = cols_lower.get('close', self.df.columns[0])

        self.reset()

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.balance = self.initial_balance
        self.net_worth = self.initial_balance
        self.prev_net_worth = self.initial_balance
        self.max_net_worth = self.initial_balance
        self.position = 0  # 1=Long, 0=None
        self.entry_price = 0
        self.current_step = 0
        self.total_trades = 0
        self.winning_trades = 0
        self.total_pnl = 0
        self.trades = []
        self.history = []
        self.steps_in_position = 0   # How many steps we've held current position
        self._last_trade_penalty = 0.0  # Tracks penalty to add in reward
        
        return self._get_observation(), {}

    def _get_observation(self):
        idx = min(self.current_step, len(self.df) - 1)
        market_obs = self.df.iloc[idx].values.astype(np.float32)
        
        # Get current price for unrealized PnL
        current_price = float(self.df.iloc[idx][self._close_col])
        unrealized_pnl = 0.0
        if self.position > 0 and self.entry_price > 0:
            unrealized_pnl = (current_price - self.entry_price) / self.entry_price
        
        # Agent state features (4 features now)
        hold_ratio = min(self.steps_in_position / max(self.min_hold_steps, 1), 1.0)  # 0→1 as position matures
        agent_state = np.array([
            float(self.position),
            unrealized_pnl,
            self.net_worth / self.initial_balance,  # Balance ratio
            hold_ratio,                              # How long we've held (teaches patience)
        ], dtype=np.float32)
        
        obs = np.concatenate([market_obs, agent_state])
        
        # Replace NaN/Inf
        obs = np.nan_to_num(obs, nan=0.0, posinf=10.0, neginf=-10.0)
        
        if self.normalize_obs:
            self.normalizer.update(obs)
            obs = self.normalizer.normalize(obs)
        
        return obs

    def step(self, action):
        current_price = float(self.df.iloc[min(self.current_step, len(self.df) - 1)][self._close_col])
        self.prev_net_worth = self.net_worth
        self._last_trade_penalty = 0.0
        
        # Execute trade
        trade_pnl = 0.0
        if action == 1:  # Buy / Long
            if self.position <= 0:
                # Position sizing: only risk a fraction of balance
                trade_amount = self.balance * self.position_size
                self.position = 1
                self.entry_price = current_price
                self.entry_amount = trade_amount  # Track how much we risked
                self.balance -= trade_amount * self.commission  # Commission on risked amount only
                self.total_trades += 1
                self.steps_in_position = 0
                self._last_trade_penalty = self.trade_penalty  # Penalise opening each trade
                self.trades.append({
                    'step': self.current_step,
                    'action': 'BUY',
                    'price': current_price
                })
        elif action == 2:  # Sell / Close
            if self.position > 0:
                # Enforce minimum holding period — ignore early-sell signals
                if self.steps_in_position < self.min_hold_steps:
                    action = 0  # Force Hold — too early to sell
                else:
                    trade_pnl = (current_price - self.entry_price) / self.entry_price
                    entry_amount = getattr(self, 'entry_amount', self.balance * self.position_size)
                    # Only the position amount changes, not the full balance
                    profit_cash = entry_amount * (trade_pnl - self.commission)
                    self.balance += profit_cash
                    self.position = 0
                    self.total_pnl += trade_pnl
                    if trade_pnl > 0:
                        self.winning_trades += 1
                    self.trades.append({
                        'step': self.current_step,
                        'action': 'SELL',
                        'price': current_price,
                        'pnl': trade_pnl
                    })
                    self.entry_price = 0
                    self.steps_in_position = 0

        # Track holding duration
        if self.position > 0:
            self.steps_in_position += 1

        # Move to next step
        self.current_step += 1

        # Update net worth
        self.net_worth = self.balance
        if self.position > 0 and self.current_step < len(self.df):
            next_price = float(self.df.iloc[min(self.current_step, len(self.df) - 1)][self._close_col])
            unrealized = (next_price - self.entry_price) / self.entry_price if self.entry_price > 0 else 0
            self.net_worth = self.balance * (1 + unrealized)
        
        self.max_net_worth = max(self.max_net_worth, self.net_worth)
        
        # --- Reward Calculation ---
        reward = self._calculate_reward(trade_pnl)
        
        done = self.current_step >= self.max_steps
        truncated = False

        info = {
            'net_worth': self.net_worth,
            'balance': self.balance,
            'position': self.position,
            'total_trades': self.total_trades,
            'winning_trades': self.winning_trades,
            'trade_pnl': trade_pnl,
            'steps_in_position': self.steps_in_position,
        }

        return self._get_observation(), reward, done, truncated, info

    def _calculate_reward(self, trade_pnl: float) -> float:
        if self.reward_mode == 'differential':
            # Step-wise change in portfolio value
            prev = max(self.prev_net_worth, 1e-8)
            step_return = (self.net_worth - self.prev_net_worth) / prev
            
            # Non-linear drawdown penalty: quadratic for large drawdowns
            drawdown = (self.max_net_worth - self.net_worth) / max(self.max_net_worth, 1e-8)
            if drawdown > 0.15:
                dd_penalty = -(drawdown ** 2) * self.drawdown_penalty * 3.0
            elif drawdown > 0.05:
                dd_penalty = -drawdown * self.drawdown_penalty
            elif drawdown > 0.02:
                dd_penalty = -drawdown * self.drawdown_penalty * 0.3
            else:
                dd_penalty = 0.0
            
            # Trade frequency penalty (charged when opening a new trade)
            trade_open_penalty = -self._last_trade_penalty
            
            return float(step_return + dd_penalty + trade_open_penalty)
        
        elif self.reward_mode == 'trade_pnl':
            # Only reward on completed trades, minus penalty for opening
            r = float(trade_pnl) if trade_pnl != 0 else 0.0
            return r - self._last_trade_penalty
        
        elif self.reward_mode == 'sharpe':
            # Approximate step-wise Sharpe-like reward
            prev = max(self.prev_net_worth, 1e-8)
            step_return = (self.net_worth - self.prev_net_worth) / prev
            drawdown = (self.max_net_worth - self.net_worth) / max(self.max_net_worth, 1e-8)
            dd_penalty = -(drawdown ** 2) * 2.0 if drawdown > 0.1 else -drawdown * 0.5
            return float(step_return + dd_penalty - self._last_trade_penalty)
        
        else:  # Legacy 'pnl' mode
            return float((self.net_worth - self.initial_balance) / self.initial_balance)


# ---------------------------------------------------------------------------
# Training Callback
# ---------------------------------------------------------------------------
class ProgressCallback(BaseCallback):
    def __init__(self, total_timesteps, progress_cb=None, verbose=0):
        super(ProgressCallback, self).__init__(verbose)
        self.total_timesteps = total_timesteps
        self.progress_cb = progress_cb
        self.last_update = 0

    def _on_step(self) -> bool:
        if self.n_calls % 100 == 0:
            # Base metrics
            policy_loss = self.locals.get("policy_gradient_loss", 0.0)
            value_loss = self.locals.get("value_loss", 0.0)
            mean_reward = 0.0
            if hasattr(self.model, "ep_info_buffer") and self.model.ep_info_buffer:
                mean_reward = np.mean([ep["r"] for ep in self.model.ep_info_buffer])

            # Logger stats (SB3 internal)
            logger_stats = {}
            if hasattr(self.model, "logger") and self.model.logger:
                for k, v in self.model.logger.name_to_value.items():
                    if isinstance(v, (int, float, np.floating, np.integer)):
                        logger_stats[k] = float(v)

            if self.progress_cb:
                self.progress_cb({
                    "phase": "training",
                    "message": f"Step {self.n_calls}/{self.total_timesteps}",
                    "stats": {
                        "iteration": self.n_calls,
                        "policy_loss": float(policy_loss),
                        "value_loss": float(value_loss),
                        "ep_rew_mean": float(mean_reward),
                        "progress_pct": round(self.n_calls / self.total_timesteps * 100, 1),
                        **logger_stats
                    }
                })
        return True


# ---------------------------------------------------------------------------
# Training Function
# ---------------------------------------------------------------------------
def train_ppo(
    exchange: str,
    df: pd.DataFrame,
    hyperparams: Dict[str, Any],
    progress_cb: Optional[Callable] = None
):
    """
    Trains a PPO model on the given data.
    Now supports dynamic feature counts from the DataFrame.
    """
    try:
        n_features = len(df.columns)
        if progress_cb:
            progress_cb({
                "phase": "setup",
                "message": f"Setting up environment with {n_features} features, {len(df)} rows"
            })

        # 1. Setup Environment
        initial_balance = hyperparams.get('initial_balance', hyperparams.get('env', {}).get('initialBalance', 10000))
        reward_mode = hyperparams.get('reward_mode', hyperparams.get('env', {}).get('rewardMode', 'differential'))
        max_steps = hyperparams.get('max_steps', hyperparams.get('env', {}).get('maxSteps', None))
        commission = hyperparams.get('commission', 0.001)
        
        env = StockTradingEnv(
            df,
            initial_balance=initial_balance,
            reward_mode=reward_mode,
            max_steps=max_steps,
            commission=commission,
            normalize_obs=True,
        )

        # 2. Setup Model
        model_name = hyperparams.get('model_name', hyperparams.get('modelName', f"PPO_{exchange}_{int(time.time())}"))
        net_arch = hyperparams.get('net_arch', hyperparams.get('networkArchitecture', [64, 64]))
        
        if isinstance(net_arch, str):
            arch_map = {
                'small': [32, 32],
                'medium': [64, 64],
                'large': [128, 128]
            }
            net_arch = arch_map.get(net_arch, [64, 64])

        policy_kwargs = dict(net_arch=dict(pi=net_arch, vf=net_arch))

        model = PPO(
            "MlpPolicy",
            env,
            learning_rate=hyperparams.get('learning_rate', hyperparams.get('learningRate', 3e-4)),
            n_steps=hyperparams.get('n_steps', hyperparams.get('nSteps', 2048)),
            batch_size=hyperparams.get('batch_size', hyperparams.get('batchSize', 64)),
            n_epochs=hyperparams.get('n_epochs', hyperparams.get('nEpochs', 10)),
            gamma=hyperparams.get('gamma', 0.99),
            clip_range=hyperparams.get('clip_range', hyperparams.get('clipRange', 0.2)),
            ent_coef=hyperparams.get('ent_coef', hyperparams.get('entCoef', 0.01)),
            vf_coef=hyperparams.get('vf_coef', hyperparams.get('vfCoef', 0.5)),
            policy_kwargs=policy_kwargs,
            verbose=0
        )

        if progress_cb:
            progress_cb({
                "phase": "training",
                "message": f"Training PPO with {n_features} features, arch={net_arch}, reward={reward_mode}"
            })

        # 3. Train
        total_timesteps = hyperparams.get('total_timesteps', hyperparams.get('totalTimesteps', 50000))
        callback = ProgressCallback(total_timesteps, progress_cb)
        
        model.learn(total_timesteps=total_timesteps, callback=callback)

        # 4. Save model + metadata
        base_dir = os.path.dirname(os.path.abspath(__file__))
        models_dir = os.path.join(base_dir, "models", "ppo")
        os.makedirs(models_dir, exist_ok=True)
        
        save_path = os.path.join(models_dir, f"{model_name}.zip")
        model.save(save_path)
        
        # Save metadata JSON alongside model
        meta = {
            "exchange": exchange,
            "n_features": n_features,
            "feature_columns": list(df.columns),
            "reward_mode": reward_mode,
            "net_arch": net_arch,
            "total_timesteps": total_timesteps,
            "learning_rate": hyperparams.get('learning_rate', hyperparams.get('learningRate', 3e-4)),
            "commission": commission,
            "initial_balance": initial_balance,
            "training_rows": len(df),
            "trained_at": datetime.utcnow().isoformat(),
        }
        meta_path = save_path.replace('.zip', '_meta.json')
        with open(meta_path, 'w') as f:
            json.dump(meta, f, indent=2)
        
        if progress_cb:
            progress_cb({
                "phase": "completed",
                "message": f"Training completed. Model saved as {model_name}.zip ({n_features} features)"
            })
            
        return save_path

    except Exception as e:
        if progress_cb:
            progress_cb({
                "phase": "error",
                "message": f"Training failed: {str(e)}"
            })
        raise


# ---------------------------------------------------------------------------
# Backtest Function
# ---------------------------------------------------------------------------
def backtest_ppo(
    model_path: Optional[str],
    df: pd.DataFrame,
    initial_balance: float = 10000,
    model: Optional[PPO] = None,
    meta: Optional[Dict] = None
):
    """
    Runs a PPO model simulation on historical data.
    If 'model' is provided, it uses it directly. Otherwise, it loads from 'model_path'.
    """
    try:
        if df.empty:
            return {"status": "error", "message": "Empty dataframe"}

        # 1. Load model and metadata
        if model is None:
            if not model_path or not os.path.exists(model_path):
                return {"status": "error", "message": f"Model not found at {model_path}"}
            model = PPO.load(model_path)
            
        if meta is None and model_path:
            meta_path = model_path.replace(".zip", "_meta.json")
            if os.path.exists(meta_path):
                with open(meta_path, "r") as f:
                    meta = json.load(f)
            else:
                meta = {}
        elif meta is None:
            meta = {}
        
        # 2. Load Model FIRST to determine expected observation shape
        reward_mode = meta.get('reward_mode', 'differential')
        commission = meta.get('commission', 0.001)
        
        # Infer expected feature count from the model's observation space.
        # Old models: obs = n_features + 3  (position, unrealized_pnl, balance_ratio)
        # New models: obs = n_features + 4  (+ hold_ratio)
        expected_obs_size = model.observation_space.shape[0]
        
        # Determine agent state size: 4 for new models, 3 for old
        # We try 4 first; if the leftover n_features matches metadata we use 4, else fall back to 3
        feature_cols_meta = meta.get('feature_columns')
        n_meta_features = len(feature_cols_meta) if feature_cols_meta else None
        
        if n_meta_features is not None:
            agent_state_size = expected_obs_size - n_meta_features
            if agent_state_size not in (3, 4):
                agent_state_size = 4  # Default to new format
        else:
            agent_state_size = 4 if (expected_obs_size % 1 == 0 and expected_obs_size > 4) else 3
        
        expected_n_features = expected_obs_size - agent_state_size
        
        # Is this a legacy model (agent_state_size=3)?
        is_legacy_model = (agent_state_size == 3)
        
        # Filter features based on metadata if available
        feature_cols = meta.get('feature_columns')
        if feature_cols and len(feature_cols) == expected_n_features:
            # Use exact columns from metadata
            available = [c for c in feature_cols if c in df.columns or c.lower() in {col.lower() for col in df.columns}]
            if len(available) == expected_n_features:
                # Case-insensitive column matching
                lower_df_cols = {c.lower(): c for c in df.columns}
                matched_cols = [c if c in df.columns else lower_df_cols.get(c.lower(), c) for c in feature_cols]
                df = df[matched_cols]
            else:
                # Fallback: take first N columns
                df = df.iloc[:, :expected_n_features]
        elif len(df.columns) != expected_n_features:
            # No metadata or column count mismatch: trim to expected size
            if len(df.columns) > expected_n_features:
                df = df.iloc[:, :expected_n_features]
            else:
                raise ValueError(
                    f"Model expects {expected_n_features} features but data only has {len(df.columns)} columns. "
                    f"Cannot pad missing features."
                )

        # 3. Setup Environment with correctly sized DataFrame
        # For legacy models (obs_size=n+3), disable min_hold to maintain compatibility
        env = StockTradingEnv(
            df,
            initial_balance=initial_balance,
            reward_mode=reward_mode,
            max_steps=len(df) - 1,
            commission=commission,
            normalize_obs=True,
            min_hold_steps=0 if is_legacy_model else 5,   # Compat: 0 = no hold restriction for old models
            trade_penalty=0.0 if is_legacy_model else 0.0005,
        )

        # 4. Run Backtest
        obs, _ = env.reset()
        done = False
        
        cols_lower = {c.lower(): c for c in df.columns}
        close_col = cols_lower.get('close', df.columns[0])
        
        history = []
        daily_returns = []
        
        # Initial state
        history.append({
            "step": 0,
            "price": float(df.iloc[0][close_col]),
            "net_worth": float(initial_balance),
            "position": 0,
            "action": 0
        })

        current_step = 0
        prev_worth = initial_balance
        
        while not done:
            action, _states = model.predict(obs, deterministic=True)
            obs, reward, done, truncated, info = env.step(action)
            
            current_step += 1
            if current_step < len(df):
                price = float(df.iloc[current_step][close_col])
                nw = float(env.net_worth)
                history.append({
                    "step": current_step,
                    "price": price,
                    "net_worth": nw,
                    "position": int(env.position),
                    "action": int(action)
                })
                
                # Track daily returns for Sharpe
                if prev_worth > 0:
                    daily_returns.append((nw - prev_worth) / prev_worth)
                prev_worth = nw
            
            if done or truncated:
                break

        # 5. Calculate Comprehensive Stats
        final_nw = float(env.net_worth)
        total_pnl_pct = (final_nw - initial_balance) / initial_balance * 100
        
        # Max Drawdown
        peak = initial_balance
        max_dd = 0
        for h in history:
            nw = h['net_worth']
            if nw > peak:
                peak = nw
            dd = (peak - nw) / peak
            if dd > max_dd:
                max_dd = dd
        
        # Sharpe Ratio (annualized, assuming daily)
        sharpe = 0.0
        if len(daily_returns) > 1:
            ret_arr = np.array(daily_returns)
            mean_ret = np.mean(ret_arr)
            std_ret = np.std(ret_arr)
            if std_ret > 0:
                sharpe = (mean_ret / std_ret) * np.sqrt(252)  # Annualized
        
        # Sortino Ratio (clipped to avoid ±inf from near-zero downside std)
        sortino = 0.0
        if len(daily_returns) > 1:
            ret_arr = np.array(daily_returns)
            downside = ret_arr[ret_arr < 0]
            if len(downside) > 1:  # Need at least 2 downside returns for meaningful std
                downside_std = np.std(downside)
                if downside_std > 1e-8:  # Guard against near-zero denominator
                    sortino = (np.mean(ret_arr) / downside_std) * np.sqrt(252)
                    sortino = float(np.clip(sortino, -100.0, 100.0))  # Prevent astronomical values
        
        # Win Rate
        win_rate = 0.0
        if env.total_trades > 0:
            win_rate = env.winning_trades / env.total_trades * 100
        
        # Buy & Hold comparison
        first_price = float(df.iloc[0][close_col])
        last_price = float(df.iloc[min(current_step, len(df) - 1)][close_col])
        buy_hold_pct = ((last_price - first_price) / first_price) * 100 if first_price > 0 else 0
        
        # Alpha (excess return over buy & hold)
        alpha = total_pnl_pct - buy_hold_pct

        return {
            "status": "success",
            "history": history,
            "final_net_worth": final_nw,
            "total_pnl_pct": float(total_pnl_pct),
            "initial_balance": float(initial_balance),
            # Enhanced metrics
            "max_drawdown_pct": float(max_dd * 100),
            "sharpe_ratio": float(round(sharpe, 3)),
            "sortino_ratio": float(round(sortino, 3)),
            "total_trades": env.total_trades,
            "winning_trades": env.winning_trades,
            "win_rate": float(round(win_rate, 1)),
            "buy_hold_pct": float(round(buy_hold_pct, 2)),
            "alpha": float(round(alpha, 2)),
            "n_features": len(df.columns),
            "total_steps": len(history),
            "trades_log": env.trades,
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }
