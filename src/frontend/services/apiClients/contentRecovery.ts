// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Access explicit, revision-guarded durable content recovery. */
import { fetchJson, postJson, projectEndpoint } from './shared';

export interface ContentRecoverySummary {
  recovery_id: string;
  status: 'prepared' | 'committed';
  document_key: string;
  filename: string;
  before_revision: string;
  after_revision: string;
  created_at: string;
  committed_at?: string | null;
}

export interface ContentRecoveryDetail extends ContentRecoverySummary {
  before_content: string;
  after_content: string;
}

export interface ContentRecoveryRestoreOptions {
  target: 'before' | 'after';
  expected_revision: string;
  expected_document_key: string;
  expected_filename?: string;
}

export interface ContentRecoveryRestoreResponse {
  ok: boolean;
  content: string;
  revision: string;
  filename: string;
  document_key: string;
}

export interface ContentRecoveryApi {
  list: () => Promise<{ records: ContentRecoverySummary[] }>;
  get: (recoveryId: string) => Promise<ContentRecoveryDetail>;
  restore: (
    recoveryId: string,
    options: ContentRecoveryRestoreOptions
  ) => Promise<ContentRecoveryRestoreResponse>;
}

function recoveryEndpoint(projectName: string, recoveryId?: string): string {
  const suffix = recoveryId
    ? `/content-recovery/${encodeURIComponent(recoveryId)}`
    : '/content-recovery';
  return projectEndpoint(projectName, suffix);
}

export const createContentRecoveryApi = (projectName: string): ContentRecoveryApi => ({
  list: async (): Promise<{ records: ContentRecoverySummary[] }> =>
    fetchJson<{ records: ContentRecoverySummary[] }>(
      recoveryEndpoint(projectName),
      undefined,
      'Failed to list content recovery records'
    ),

  get: async (recoveryId: string): Promise<ContentRecoveryDetail> =>
    fetchJson<ContentRecoveryDetail>(
      recoveryEndpoint(projectName, recoveryId),
      undefined,
      'Failed to get content recovery record'
    ),

  restore: async (
    recoveryId: string,
    options: ContentRecoveryRestoreOptions
  ): Promise<ContentRecoveryRestoreResponse> =>
    postJson<ContentRecoveryRestoreResponse>(
      `${recoveryEndpoint(projectName, recoveryId)}/restore`,
      options,
      'Failed to restore content recovery record'
    ),
});

export const contentRecoveryApi = createContentRecoveryApi('');
