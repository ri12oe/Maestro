import { defineRailway, project, service } from "railway/iac";

// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "maestro";
export default defineRailway(() => {
  const maestro = service("maestro", {
    build: { builder: "RAILPACK", buildCommand: "npm run build" },
    start: "npm start",
    deploy: { restartPolicyType: "ON_FAILURE" },
  });

  return project("Maestro", {
    resources: [maestro],
  });
});
