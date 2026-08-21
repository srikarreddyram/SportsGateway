import type { ApiErrorBody, Envelope } from '../types';

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error?.message ?? `Request failed with status ${status}`);
    this.code = body?.error?.code ?? 'unknown_error';
    this.status = status;
  }
}

/**
 * Thin fetch wrapper — this UI is a client of the gateway, not a special case of it, so
 * it goes through exactly the endpoints and response envelope any consumer would see.
 */
async function get<T>(path: string): Promise<Envelope<T>> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as Envelope<T>;
}

export const api = {
  fixtures: (date: string) =>
    get<{ date: string; count: number; matches: import('../types').Match[] }>(`/api/fixtures/${date}`),
  match: (matchId: string | number) => get<{ match: import('../types').Match }>(`/api/scores/${matchId}`),
  player: (playerId: string | number, season?: number) =>
    get<{ player: import('../types').Player }>(`/api/players/${playerId}${season ? `?season=${season}` : ''}`),
};
