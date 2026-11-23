export default {
  glaze: {
    input: "../openapi.json",
    output: {
      schemas: { path: "./src/generated/api.d.ts", mode: "single" },
      override: { enumGenerationType: "union" },
    },
  },
};
