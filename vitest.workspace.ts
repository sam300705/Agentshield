export default [
  {
    test: {
      name: "api",
      root: "./apps/api",
      environment: "node",
    },
  },
  {
    test: {
      name: "policy-engine",
      root: "./packages/policy-engine",
      environment: "node",
    },
  },
  {
    test: {
      name: "scanner",
      root: "./packages/scanner",
      environment: "node",
    },
  },
  {
    test: {
      name: "web-dashboard",
      root: "./apps/web-dashboard",
      environment: "jsdom",
    },
  },
];
