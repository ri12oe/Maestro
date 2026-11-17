import { defineRailway, github, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "Maestro";
export default defineRailway(() => {
  const Maestro = service("Maestro", {
    source: github("ri12oe/Maestro", { upstreamUrl: "https://github.com/ri12oe/Maestro" }),
    build: { buildCommand: "npm run build", buildEnvironment: "V3", builder: "RAILPACK" },
    start: "npm start",
    healthcheck: "/api/health",
    replicas: { "sfo": 1 },
    deploy: { restartPolicyType: "ON_FAILURE" },
    networking: { privateNetworkEndpoint: "maestro" },
  });

  return project("lucid-courtesy", {
    variables: { managed: false },
    resources: [Maestro],
  });
});
