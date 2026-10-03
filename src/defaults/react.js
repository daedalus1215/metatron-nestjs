/**
 * Profile: a React + TypeScript frontend (spec 12). Vite, react-router,
 * react-query and an axios client, laid out as pages with their own
 * components and hooks, shared components/hooks/contexts, and a request layer.
 *
 * As with the nestjs profile, everything here is data: a project with another
 * layout overrides it in its own arch.config.js, and the coverage line says
 * when it should.
 */
'use strict';

module.exports = {
  root: 'src',
  extensions: ['.ts', '.tsx'],
  ignore: [/node_modules/, /\/dist\//, /\/dev-dist\//, /\.d\.ts$/],

  /** Imports that begin with this are root-relative (none by default; see `aliases`). */
  absoluteImportPrefix: '\u0000',

  /** Import prefixes, as in vite.config / tsconfig paths: { '@': 'src' }. */
  aliases: {},

  /** Which wiring model the scan builds (spec 12). */
  wiring: 'react',

  /**
   * Tiers, ordered the way a user's action travels: a route mounts a page,
   * the page renders components, they use hooks, hooks call the request
   * layer, which reaches the backend.
   */
  tiers: [
    { name: 'Route', sub: 'router & app' },
    { name: 'Page', sub: 'routed screens' },
    { name: 'Component', sub: 'UI' },
    { name: 'Hook', sub: 'data & behaviour' },
    { name: 'State', sub: 'contexts & stores' },
    { name: 'Request', sub: 'API client & adapters' },
    { name: 'Contract', sub: 'DTOs & types' },
    { name: 'Support', sub: 'utils, constants, theme' },
    { name: 'Platform', sub: 'bootstrap & config' },
    { name: 'Test', sub: 'specs & fixtures' },
  ],

  /** File -> pattern, first match wins. `test` is a RegExp on the root-relative path. */
  patterns: [
    { id: 'spec', tier: 'Test', test: /\.(test|spec)\.tsx?$|__tests__\/|__specs__\// },
    { id: 'test-util', tier: 'Test', test: /test-utils|__mocks__|setupTests/ },
    { id: 'bootstrap', tier: 'Platform', test: /^main\.tsx?$|^index\.tsx?$/ },
    { id: 'config', tier: 'Platform', test: /\.config\.tsx?$|(^|\/)config\// },
    { id: 'constants', tier: 'Support', test: /(^|\/)constants?(\/|\.tsx?$)/ },
    { id: 'router', tier: 'Route', test: /^App\.tsx$|(^|\/)router\/|(^|\/)routes?\.tsx$/ },
    { id: 'dto', tier: 'Contract', test: /(^|\/)dtos?\/|\.dto\.tsx?$|(^|\/)types?\/|\.types?\.tsx?$|(^|\/)responses?\.ts$/ },
    { id: 'context', tier: 'State', test: /(^|\/)contexts?\/|Context\.tsx?$|Provider\.tsx$/ },
    { id: 'store', tier: 'State', test: /(^|\/)(store|stores)\// },
    { id: 'hook', tier: 'Hook', test: /(^|\/)use[A-Z][^/]*\.tsx?$|(^|\/)hooks\// },
    { id: 'request', tier: 'Request', test: /(^|\/)api\/|\.requests?\.ts$|\.api\.ts$/ },
    { id: 'adapter', tier: 'Request', test: /(^|\/)(adapters?|infrastructure)\/|\.adapter\.ts$/ },
    { id: 'service', tier: 'Request', test: /(^|\/)(services|core)\// },
    { id: 'page', tier: 'Page', test: /^pages\/[^/]+\/[^/]+\.tsx$/ },
    { id: 'component', tier: 'Component', test: /\.tsx$/ },
    { id: 'util', tier: 'Support', test: /(^|\/)(utils?|lib|helpers?)(\/|\.tsx?$)|\.utils?\.ts$/ },
    { id: 'theme', tier: 'Support', test: /(^|\/)theme\.ts$|(^|\/)styles?\// },
    { id: 'auth', tier: 'Request', test: /^auth\// },
  ],

  fallback: { id: 'other', tier: 'Support' },

  /**
   * Components reach the API through hooks: a component (or page) importing
   * the request layer directly skips the hook. Declared as a flow so the
   * rule is derived, not hand-listed.
   */
  flow: ['component', 'hook', 'request'],
  flowAliases: { component: ['page'], request: ['adapter'] },

  forbidden: [
    { from: 'request', to: 'component', why: 'The request layer imports a UI component' },
    { from: 'request', to: 'hook', why: 'The request layer imports a hook' },
    { from: 'hook', to: 'page', why: 'A hook imports a page' },
  ],

  noSameLevel: [],

  /**
   * Shared buckets are infrastructure; the pages are the bounded contexts. A
   * page importing another page's internals is the frontend's cross-context
   * leak, and may only land on the other page's top component.
   */
  infraModules: ['(root)', 'components', 'hooks', 'api', 'contexts', 'auth', 'adapters',
    'infrastructure', 'core', 'services', 'router', 'lib', 'utils', 'constants', 'styles', 'assets', 'store'],
  crossDomainGateways: ['page'],

  /** Reachability starts at the app's entry (main.tsx), not at modules and handlers. */
  orphanRoots: ['bootstrap'],

  /** pages/<Page>/… is the module <Page>; everything else its first segment. */
  moduleOf: (rel) => {
    const parts = rel.split('/');
    if (parts.length === 1) return '(root)';
    if (parts[0] === 'pages' && parts.length > 2) return parts[1];
    return parts[0];
  },

  testLocators: [
    (rel) => rel.replace(/\.(tsx?)$/, '.test.$1'),
    (rel) => rel.replace(/\.(tsx?)$/, '.spec.$1'),
    (rel) => rel.replace(/\/([^/]+)\.(tsx?)$/, '/__tests__/$1.test.$2'),
  ],

  couplingMaxFiles: 25,
  couplingMinChanges: 5,
  couplingMinDegree: 0.3,

  naming: [],
};
