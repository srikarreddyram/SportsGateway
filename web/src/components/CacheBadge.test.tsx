import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CacheBadge } from './CacheBadge';
import type { CacheMeta } from '../types';

const meta = (overrides: Partial<CacheMeta> = {}): CacheMeta => ({
  cache: 'HIT',
  ageMs: 0,
  instance: 'gw-1',
  requestId: 'abc',
  ...overrides,
});

describe('CacheBadge', () => {
  it('shows the cache status the gateway reported', () => {
    render(<CacheBadge meta={meta({ cache: 'MISS' })} />);
    expect(screen.getByText(/MISS/)).toBeInTheDocument();
  });

  it('hides the age when the entry was served fresh, since "0s ago" is noise', () => {
    render(<CacheBadge meta={meta({ ageMs: 0 })} />);
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
  });

  it('shows how stale a cached entry is once it has an age', () => {
    render(<CacheBadge meta={meta({ ageMs: 65_000 })} />);
    expect(screen.getByText(/1m ago/)).toBeInTheDocument();
  });

  it('flags a degraded response, which is the whole point of the FALLBACK state', () => {
    render(<CacheBadge meta={meta({ cache: 'FALLBACK', degraded: true, ageMs: 5000 })} />);
    expect(screen.getByText(/FALLBACK/)).toBeInTheDocument();
    expect(screen.getByText(/degraded/)).toBeInTheDocument();
  });

  it('surfaces the serving instance in the title, so a scaling demo is inspectable', () => {
    const { container } = render(<CacheBadge meta={meta({ instance: 'gw-7' })} />);
    expect(container.querySelector('[title]')).toHaveAttribute('title', expect.stringContaining('gw-7'));
  });
});
