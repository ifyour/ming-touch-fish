const TANSTACK_OVERRIDES = {
  '@tanstack/react-router': '1.114.1',
  '@tanstack/router-core': '1.114.1',
  '@tanstack/router-generator': '1.114.1',
  '@tanstack/router-plugin': '1.114.1',
  '@tanstack/server-functions-plugin': '1.114.1',
  '@tanstack/react-start': '1.114.1',
  '@tanstack/react-start-client': '1.114.1',
  '@tanstack/react-start-config': '1.114.1',
  '@tanstack/react-start-plugin': '1.114.1',
  '@tanstack/react-start-router-manifest': '1.114.1',
  '@tanstack/react-start-server': '1.114.1',
  '@tanstack/react-start-api-routes': '1.114.1',
  '@tanstack/react-start-server-functions-client': '1.114.1',
  '@tanstack/react-start-server-functions-handler': '1.114.1',
  '@tanstack/react-start-server-functions-ssr': '1.114.1',
};

module.exports = {
  hooks: {
    readPackage(pkg) {
      for (const [dep, version] of Object.entries(TANSTACK_OVERRIDES)) {
        if (pkg.dependencies?.[dep]) {
          pkg.dependencies[dep] = version;
        }
        if (pkg.peerDependencies?.[dep]) {
          pkg.peerDependencies[dep] = version;
        }
      }
      return pkg;
    },
  },
};
