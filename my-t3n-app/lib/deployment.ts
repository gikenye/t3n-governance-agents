import { readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";

const STATE_PATH = fileURLToPath(new URL("../.t3n-deployment.json", import.meta.url));

export interface DeploymentState {
  contractId: string;
  version: string;
}

interface DeploymentFile {
  [tail: string]: DeploymentState;
}

export async function readDeployment(tail: string): Promise<DeploymentState | null> {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    const deployments = JSON.parse(raw) as DeploymentFile;
    return deployments[tail] ?? null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function saveDeployment(
  tail: string,
  deployment: DeploymentState,
): Promise<void> {
  let deployments: DeploymentFile = {};
  try {
    deployments = JSON.parse(await readFile(STATE_PATH, "utf8")) as DeploymentFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  deployments[tail] = deployment;
  await writeFile(STATE_PATH, `${JSON.stringify(deployments, null, 2)}\n`, "utf8");
}

export async function clearDeployment(tail: string): Promise<void> {
  let deployments: DeploymentFile;
  try {
    deployments = JSON.parse(await readFile(STATE_PATH, "utf8")) as DeploymentFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  delete deployments[tail];
  await writeFile(STATE_PATH, `${JSON.stringify(deployments, null, 2)}\n`, "utf8");
}
