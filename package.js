Package.describe({
  name: 'anonyfox:publication-collector',
  version: '0.0.1',
  summary: 'Collect publications for testing (Meteor 3.3+)',
  git: 'https://github.com/Anonyfox/meteor-publication-collector',
  documentation: 'README.md'
});

Package.onUse(function(api) {
  api.versionsFrom(['3.3']);

  api.use('ecmascript');
  api.use('typescript');

  api.mainModule('src/index.ts', 'server');
});

Package.onTest(function(api) {
  api.use('ecmascript');
  api.use('typescript');
  api.use('meteortesting:mocha');
  api.use('mongo');
  api.use('random');
  api.use('anonyfox:publication-collector');

  api.mainModule('tests/index.test.ts', 'server');
});
