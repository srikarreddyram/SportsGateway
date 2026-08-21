import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFavoriteLeagues } from './useFavoriteLeagues';

describe('useFavoriteLeagues', () => {
  it('starts with nothing pinned', () => {
    const { result } = renderHook(() => useFavoriteLeagues());
    expect(result.current.isFavorite('Premier League')).toBe(false);
  });

  it('toggles a league on and back off', () => {
    const { result } = renderHook(() => useFavoriteLeagues());

    act(() => result.current.toggle('Premier League'));
    expect(result.current.isFavorite('Premier League')).toBe(true);

    act(() => result.current.toggle('Premier League'));
    expect(result.current.isFavorite('Premier League')).toBe(false);
  });

  it('persists across remounts, which is the only reason this uses localStorage', () => {
    const first = renderHook(() => useFavoriteLeagues());
    act(() => first.result.current.toggle('La Liga'));
    first.unmount();

    const second = renderHook(() => useFavoriteLeagues());
    expect(second.result.current.isFavorite('La Liga')).toBe(true);
  });

  it('survives corrupt localStorage instead of crashing the page', () => {
    localStorage.setItem('sportsgateway:favorite-leagues', 'not json{');
    const { result } = renderHook(() => useFavoriteLeagues());
    expect(result.current.isFavorite('Serie A')).toBe(false);
  });
});
