import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'sportsgateway:favorite-leagues';

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Pinning leagues is purely a client-side preference — no gateway endpoint needed. */
export function useFavoriteLeagues() {
  const [favorites, setFavorites] = useState<Set<string>>(() => load());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...favorites]));
  }, [favorites]);

  const toggle = useCallback((league: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(league)) next.delete(league);
      else next.add(league);
      return next;
    });
  }, []);

  const isFavorite = useCallback((league: string) => favorites.has(league), [favorites]);

  return { isFavorite, toggle };
}
