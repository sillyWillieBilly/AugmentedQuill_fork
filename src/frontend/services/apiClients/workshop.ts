// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Access the dedicated workshop endpoint without any write tools. */
import { fetchJson, projectEndpoint } from './shared';
import type { WorkshopRequest, WorkshopResponse } from '../../features/workshop/types';

export interface WorkshopApi {
  discuss: (body: WorkshopRequest, signal?: AbortSignal) => Promise<WorkshopResponse>;
}

export const createWorkshopApi = (projectName: string): WorkshopApi => ({
  discuss: (body: WorkshopRequest, signal?: AbortSignal): Promise<WorkshopResponse> =>
    fetchJson<WorkshopResponse>(
      projectEndpoint(projectName, '/workshop/discuss'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      },
      'Workshop request failed'
    ),
});
