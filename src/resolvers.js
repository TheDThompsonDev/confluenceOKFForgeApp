import Resolver from '@forge/resolver';
import api from '@forge/api';
import { getSpaces } from './lib/confluence';
import { buildGraph } from './lib/graph';
import { getWatchedSpaces, setWatchedSpaces, runHealthCheck } from './maintenance';
import { seedDemoSpace } from './seed';

const resolver = new Resolver();

resolver.define('getSpaces', async () => {
  return getSpaces(api.asUser());
});

resolver.define('getGraph', async ({ payload }) => {
  if (!payload?.spaceKey) throw new Error('spaceKey is required');
  return buildGraph(api.asUser(), payload.spaceKey);
});

resolver.define('getWatchedSpaces', async () => {
  return getWatchedSpaces();
});

resolver.define('watchSpace', async ({ payload }) => {
  const watched = await getWatchedSpaces();
  if (!watched.includes(payload.spaceKey)) {
    return setWatchedSpaces([...watched, payload.spaceKey]);
  }
  return watched;
});

resolver.define('unwatchSpace', async ({ payload }) => {
  const watched = await getWatchedSpaces();
  return setWatchedSpaces(watched.filter((k) => k !== payload.spaceKey));
});

resolver.define('runHealthCheck', async ({ payload }) => {
  if (!payload?.spaceKey) throw new Error('spaceKey is required');
  return runHealthCheck(api.asUser(), payload.spaceKey);
});

resolver.define('seedDemo', async ({ payload }) => {
  if (!payload?.spaceKey) throw new Error('spaceKey is required');
  return seedDemoSpace(api.asUser(), payload.spaceKey);
});

export const handler = resolver.getDefinitions();
