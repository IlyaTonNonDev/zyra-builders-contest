import fs from "fs";
import path from "path";

export function assertEnvFileIsPrivate(
  envPath: string = path.join(process.cwd(), ".env"),
): void {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const stat = fs.statSync(envPath);
  const mode = stat.mode & 0o777;

  // Require owner-only permissions (chmod 600)
  if ((mode & 0o077) !== 0) {
    throw new Error(
      ".env permissions are too open. Set chmod 600 so only the owner can read it.",
    );
  }
}
