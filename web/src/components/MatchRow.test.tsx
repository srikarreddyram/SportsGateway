import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MatchRow } from './MatchRow';
import { makeMatch, makeLiveMatch } from '../test/fixtures';

const renderRow = (match: Parameters<typeof MatchRow>[0]['match']) =>
  render(
    <MemoryRouter>
      <MatchRow match={match} />
    </MemoryRouter>,
  );

describe('MatchRow', () => {
  it('renders both teams and the current score', () => {
    renderRow(makeMatch());
    expect(screen.getByText('Manchester United')).toBeInTheDocument();
    expect(screen.getByText('Liverpool')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows elapsed minutes for a live match rather than a kickoff time', () => {
    renderRow(makeLiveMatch());
    expect(screen.getByText("67'")).toBeInTheDocument();
  });

  it('shows FT for a finished match', () => {
    renderRow(makeMatch());
    expect(screen.getByText('FT')).toBeInTheDocument();
  });

  it('shows the halftime score, which a scores app is expected to carry', () => {
    renderRow(makeMatch());
    expect(screen.getByText('HT 1-0')).toBeInTheDocument();
  });

  it('links to the match detail route', () => {
    renderRow(makeMatch({ matchId: 4242 }));
    expect(screen.getByRole('link')).toHaveAttribute('href', '/match/4242');
  });

  it('renders a scheduled match without inventing a score', () => {
    const scheduled = makeMatch({
      status: { short: 'NS', description: 'Not Started', elapsed: null, live: false, finished: false },
      score: {
        current: { home: null, away: null },
        halftime: { home: null, away: null },
        fulltime: { home: null, away: null },
        extratime: { home: null, away: null },
        penalty: { home: null, away: null },
      },
    });
    renderRow(scheduled);
    expect(screen.getAllByText('-')).toHaveLength(2);
    expect(screen.queryByText(/HT/)).not.toBeInTheDocument();
  });
});
