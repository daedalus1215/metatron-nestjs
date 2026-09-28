/**
 * Default profile: a NestJS backend that carries its architecture in filenames.
 *
 * A project overrides any of this in its own `arch.config.js`. Everything here is
 * data — no project should need to edit the scanner.
 */
'use strict';

module.exports = {
  /** Scanned root, relative to the config file. */
  root: 'src',

  /** Ignored anywhere in the path. */
  ignore: [/node_modules/, /\/dist\//, /\.d\.ts$/],

  /**
   * Architectural tiers, ordered the way a request travels. Index is depth:
   * earlier tiers are nearer the caller. Lenses render them in this order.
   */
  tiers: [
    { name: 'Entry', sub: 'HTTP / WS surface' },
    { name: 'Contract', sub: 'DTOs & commands' },
    { name: 'Service', sub: 'orchestration' },
    { name: 'Aggregator', sub: 'cross-domain' },
    { name: 'Transaction Script', sub: 'use-case logic' },
    { name: 'Mapping', sub: 'converters & mappers' },
    { name: 'Persistence', sub: 'repositories' },
    { name: 'Domain Model', sub: 'entities & ports' },
    { name: 'Wiring', sub: 'modules' },
    { name: 'Platform', sub: 'bootstrap & migrations' },
    { name: 'Test', sub: 'specs & fixtures' },
  ],

  /**
   * File -> pattern. First match wins, so order matters: shape-specific names
   * should beat the folder a file happens to sit in.
   *
   * `test` is a RegExp against the root-relative path, or (rel, base) => boolean.
   */
  patterns: [
    { id: 'spec', tier: 'Test', test: /\.spec\.ts$|__specs__/ },
    { id: 'test-util', tier: 'Test', test: /test-utils|mock-factories|__mocks__/ },
    { id: 'migration', tier: 'Platform', test: /(^|\/)migrations\// },
    { id: 'bootstrap', tier: 'Platform', test: /^bootstrap\/|data-source\.ts$|^(main|app\.module)\.ts$/ },

    { id: 'converter', tier: 'Mapping', test: /converter/i },
    { id: 'mapper', tier: 'Mapping', test: /mapper/i },
    { id: 'assembler', tier: 'Mapping', test: /assembler/i },

    { id: 'module', tier: 'Wiring', test: /\.module\.ts$/ },
    { id: 'action', tier: 'Entry', test: /\.action\.ts$/ },
    { id: 'controller', tier: 'Entry', test: /\.controller\.ts$/ },
    { id: 'resolver', tier: 'Entry', test: /\.resolver\.ts$/ },
    { id: 'gateway', tier: 'Entry', test: /\.gateway\.ts$|registry\.ts$/ },
    { id: 'guard', tier: 'Entry', test: /\.guard\.ts$|authenticator\.ts$/ },
    { id: 'interceptor', tier: 'Entry', test: /\.interceptor\.ts$|\.pipe\.ts$|\.filter\.ts$/ },
    { id: 'decorator', tier: 'Entry', test: /\.decorator\.ts$/ },
    { id: 'listener', tier: 'Entry', test: /listener/i },
    { id: 'swagger', tier: 'Entry', test: /\.swagger\.ts$/ },
    { id: 'responder', tier: 'Entry', test: /\.responder\.ts$/ },
    { id: 'adapter', tier: 'Entry', test: /\.adapter\.ts$/ },

    // AGENTS.md-style DDD shapes; harmless on projects that have none
    { id: 'transaction-script', tier: 'Transaction Script', test: /\.transaction[.-]script\.ts$/ },
    { id: 'projection', tier: 'Transaction Script', test: /projection/i },
    { id: 'aggregator', tier: 'Aggregator', test: /aggregator/i },
    { id: 'service', tier: 'Service', test: /\.service\.ts$/ },
    { id: 'repository', tier: 'Persistence', test: /\.repository\.ts$/ },
    { id: 'hydrator', tier: 'Persistence', test: /hydrator/i },
    { id: 'remote-caller', tier: 'Persistence', test: /remote-caller|\.caller\.ts$/i },
    { id: 'cache', tier: 'Persistence', test: /\.cache\.ts$/ },
    { id: 'entity', tier: 'Domain Model', test: /\.entity\.ts$/ },
    { id: 'schema', tier: 'Domain Model', test: /\.schema\.ts$/ },
    { id: 'port', tier: 'Domain Model', test: /\.port\.ts$|\/ports\// },

    { id: 'dto', tier: 'Contract', test: /\.dto\.ts$|\.params\.ts$|\/dtos?\// },
    { id: 'command', tier: 'Contract', test: /\.command\.ts$|cross-domain-commands/ },
    { id: 'event', tier: 'Contract', test: /\.event\.ts$/ },

    { id: 'strategy', tier: 'Wiring', test: /\.strategy\.ts$/ },
    { id: 'config', tier: 'Wiring', test: /\.config\.ts$|\.constants\.ts$/ },
    { id: 'util', tier: 'Wiring', test: /\.utils?\.ts$|\.helpers?\.ts$/ },
  ],

  /** Anything unmatched lands here. A high share means the config is wrong. */
  fallback: { id: 'other', tier: 'Wiring' },

  /**
   * The intended call flow. Skip rules are derived from it: an import that jumps
   * more than one step forward is a layering violation, and its severity grows
   * with the size of the jump. Declaring the flow beats hand-listing rules.
   */
  flow: ['action', 'service', 'transaction-script', 'repository'],

  /** Flow aliases: other patterns that count as the same station. */
  flowAliases: { action: ['controller', 'resolver'], repository: ['remote-caller'] },

  /** Imports that must never go this direction, whatever the flow says. */
  forbidden: [
    { from: 'transaction-script', to: 'service', why: 'Transaction Script calls upward into a Service' },
    { from: 'repository', to: 'transaction-script', why: 'Repository calls upward into a Transaction Script' },
    { from: 'aggregator', to: 'service', why: 'Aggregator calls upward into a Service' },
  ],

  /** Patterns that must not inject their own kind (no same-level injection). */
  noSameLevel: ['transaction-script', 'service', 'aggregator', 'mapper', 'assembler', 'converter'],

  /** Modules that are infrastructure rather than bounded contexts. */
  infraModules: ['shared-kernel', 'typeorm', 'bootstrap', 'main.ts', 'app.module.ts', 'common', 'core'],

  /** Cross-context imports may only land on these patterns. */
  crossDomainGateways: ['aggregator', 'port'],

  /**
   * First path segment is the module. A file sitting at the root has no module
   * of its own, so it is grouped under (root) rather than becoming one.
   */
  moduleOf: (rel) => {
    const head = rel.split('/')[0];
    return head.endsWith('.ts') ? '(root)' : head;
  },

  /** Naming conventions to flag when a file deviates. */
  naming: [
    {
      id: 'ts-suffix',
      title: 'Transaction scripts using a non-canonical file suffix',
      test: /\.transaction-script\.ts$/,
      why: 'canonical form is *.transaction.script.ts',
    },
  ],
};
