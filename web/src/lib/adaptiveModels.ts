"use client";

import type { LocalModelMeta } from "@/lib/api";

export type AdaptiveModelInfo = LocalModelMeta & {
  name: string;
  displayName: string;
  normalizedName: string;
  exchangeNormalized?: string;
  role: "primary" | "council";
};

export type SuggestedModelSettings = {
  targetPct: number;
  stopLossPct: number;
  holdDays: number;
  thresholdPct: number;
  metaThreshold01: number;
};

const DEFAULT_SETTINGS: SuggestedModelSettings = {
  targetPct: 10,
  stopLossPct: 5,
  holdDays: 20,
  thresholdPct: 50,
  metaThreshold01: 0.6,
};

function asRatio01(value: number | undefined | null): number | undefined {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return undefined;
  const n = Number(value);
  if (Math.abs(n) <= 1) return Math.min(1, Math.max(0, n));
  return Math.min(1, Math.max(0, n / 100));
}

function asPercent(value: number | undefined | null, fallback: number): number {
  const ratio = asRatio01(value);
  if (ratio === undefined) return fallback;
  return Number((ratio * 100).toFixed(2));
}

function asDays(value: number | undefined | null, fallback: number): number {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return fallback;
  return Math.max(1, Math.round(Number(value)));
}

function normalizeExchange(exchange?: string): string | undefined {
  const value = exchange?.trim().toUpperCase();
  return value || undefined;
}

function inferRole(model: LocalModelMeta, normalizedName: string): "primary" | "council" {
  if (model.model_type === "council_validator") return "council";
  if (normalizedName.includes("COUNCIL") || normalizedName.includes("VALIDATOR")) return "council";
  return "primary";
}

export function normalizeAdaptiveModels(models: (string | LocalModelMeta)[]): AdaptiveModelInfo[] {
  return models
    .map((model) => {
      const meta = typeof model === "string" ? ({ name: model } as LocalModelMeta) : model;
      const normalizedName = (meta.name || "").replace(/\.pkl$/i, "").toUpperCase();
      return {
        ...meta,
        name: meta.name,
        displayName: (meta.name || "").replace(/\.pkl$/i, ""),
        normalizedName,
        exchangeNormalized: normalizeExchange(meta.exchange),
        role: inferRole(meta, normalizedName),
      };
    })
    .filter((model) => Boolean(model.name));
}

export function modelSupportsExchange(model: AdaptiveModelInfo, exchange?: string): boolean {
  const exchangeNormalized = normalizeExchange(exchange);
  if (!exchangeNormalized || !model.exchangeNormalized) return true;
  return model.exchangeNormalized === exchangeNormalized;
}

export function filterPrimaryModels(models: AdaptiveModelInfo[], exchange?: string): AdaptiveModelInfo[] {
  return models.filter((model) => model.role === "primary" && modelSupportsExchange(model, exchange));
}

export function filterCouncilModels(models: AdaptiveModelInfo[], exchange?: string): AdaptiveModelInfo[] {
  return models.filter((model) => model.role === "council" && modelSupportsExchange(model, exchange));
}

export function pickDefaultPrimaryModel(models: AdaptiveModelInfo[], exchange?: string): AdaptiveModelInfo | null {
  const eligible = filterPrimaryModels(models, exchange);
  return eligible[0] ?? null;
}

export function pickDefaultCouncilModel(models: AdaptiveModelInfo[], exchange?: string): AdaptiveModelInfo | null {
  const eligible = filterCouncilModels(models, exchange);
  return eligible[0] ?? null;
}

export function getSuggestedModelSettings(model?: AdaptiveModelInfo | null): SuggestedModelSettings {
  if (!model) return DEFAULT_SETTINGS;
  const thresholdPct = asPercent(model.buyThreshold ?? model.meta_threshold, DEFAULT_SETTINGS.thresholdPct);
  return {
    targetPct: asPercent(model.target_pct, DEFAULT_SETTINGS.targetPct),
    stopLossPct: asPercent(model.stop_loss_pct, DEFAULT_SETTINGS.stopLossPct),
    holdDays: asDays(model.look_forward_days, DEFAULT_SETTINGS.holdDays),
    thresholdPct,
    metaThreshold01: asRatio01(model.meta_threshold) ?? DEFAULT_SETTINGS.metaThreshold01,
  };
}
