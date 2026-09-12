// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Typed workshop conversation and model response contracts. */
import type { PassageTarget } from './passageTarget';

export interface WorkshopMessage {
  role: 'user' | 'assistant';
  content: string;
}
export interface WorkshopAlternative {
  id: string;
  label: string;
  replacement: string;
}
export interface WorkshopContext {
  messages: { role: string; content: string }[];
  selected_lore: Record<string, unknown>[];
  excluded_lore: { id: string; reason: string }[];
  lore_decisions?: {
    entry_id: string;
    included: boolean;
    reason: string;
    matched_primary: string[];
    matched_secondary: string[];
    estimated_tokens: number;
    priority: number;
    recursion_step: number;
  }[];
  unsupported_options?: string[];
  budget: {
    context_limit_tokens: number;
    context_budget_tokens?: number;
    estimated_prompt_tokens: number;
    output_reserve_tokens: number;
  };
  warnings: string[];
}
export interface WorkshopResponse {
  discussion: string;
  alternatives: WorkshopAlternative[];
  target_id: string;
  fingerprint: string;
  context: WorkshopContext;
}
export interface WorkshopRequest {
  target: PassageTarget;
  messages: WorkshopMessage[];
  model_name?: string;
  author_viewpoint?: string;
  timeline?: string;
  timeline_position?: number;
  budget?: { context_tokens?: number; output_tokens?: number };
}
export interface WorkshopTurn extends WorkshopMessage {
  id: string;
  response?: WorkshopResponse;
  decisions?: Record<string, 'applied' | 'rejected'>;
}
export interface WorkshopSession {
  id: string;
  target: PassageTarget;
  turns: WorkshopTurn[];
  scopeContext?: { viewpoint: string; timeline: string; timelinePosition?: number };
}
