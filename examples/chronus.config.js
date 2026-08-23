/** arch-lens config for the Chronus backend. See ../../arch-lens/README.md */
module.exports = {
  extends: 'nestjs',
  name: 'chronus',
  root: 'src',
  outDir: 'tools/out',

  // helper files that live inside a service folder but carry no *.service.ts suffix
  addPatterns: [
    {
      id: 'service', tier: 'Service',
      // helpers inside a service folder count as service, but a *.converter.ts
      // in there is still a converter — shape beats location
      test: (rel, base) =>
        /note-transfer\/domain\/services\//.test(rel) && !/converter|mapper|assembler/i.test(base),
    },
  ],

  infraModules: ['shared-kernel', 'typeorm', 'bootstrap', 'main.ts', 'app.module.ts'],
};
