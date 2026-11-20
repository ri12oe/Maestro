import { defineRailway, github, project, service } from "railway/iac";

// railway@3.17.0's ProjectDefinition type omits this field. The CLI still
// reads it (railway-ts-sdk#106). managed: false keeps service variables in
// the dashboard.
declare module "railway/iac" {
  interface ProjectDefinition {
    variables?: {
      managed?: boolean;
    };
  }
}
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
//
// This file is the only Railway config. railway.json is deleted. Its settings:
//   build.builder RAILPACK
//   build.buildCommand "npm run build"
//   deploy.startCommand "npm start"            -> start
//   deploy.healthcheckPath "/api/health"       -> healthcheck
//   deploy.restartPolicyType "ON_FAILURE"      -> deploy.restartPolicyType
// railway.json had no healthcheckTimeout, restartPolicyMaxRetries,
// preDeployCommand, requiredMountPath, environments block, or volume.
// Those stay unset. The /data volume is the dashboard mount.
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
