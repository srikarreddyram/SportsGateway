import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';
import swaggerUi from 'swagger-ui-express';

// openapi.yaml lives at the repo root, next to package.json — a peer of src/, not a
// runtime asset copied into the Docker image build stage. It is read once at startup
// rather than per-request since it never changes while the process is running.
const specPath = fileURLToPath(new URL('../../openapi.yaml', import.meta.url));
const spec = loadYaml(readFileSync(specPath, 'utf8'));

export function createDocsRouter() {
  const router = Router();

  router.get('/openapi.json', (req, res) => res.json(spec));
  router.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'SportsGateway API' }));

  return router;
}
