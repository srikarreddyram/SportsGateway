import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <p className="text-sm text-text-muted">Nothing here.</p>
      <Link to="/" className="mt-4 inline-block text-sm text-accent hover:underline">
        Back to fixtures
      </Link>
    </div>
  );
}
