import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "world-cup-bet";
const configuredBase = process.env.VITE_BASE_PATH?.trim();
const base =
  configuredBase ||
  (process.env.GITHUB_PAGES === "true" ? `/${repositoryName}/` : "/");

export default defineConfig({
  base,
  plugins: [react()],
});
