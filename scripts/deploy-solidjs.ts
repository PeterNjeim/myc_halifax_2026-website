import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

const DIST = "dist";
const TARGET = "../myc-deploy-master/solidjs";

async function copyDir(src: string, dest: string) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            await copyDir(srcPath, destPath);
        } else {
            await fs.copyFile(srcPath, destPath);
        }
    }
}

async function main() {
    console.log("Deploying to master:/solidjs...");

    // wipe old
    await fs.rm(TARGET, { recursive: true, force: true });

    // copy new build
    await copyDir(DIST, TARGET);

    // add .nojekyll
    await fs.writeFile(path.join(TARGET, ".nojekyll"), "");

    console.log("Copied build");

    // git ops inside worktree
    const cwd = path.resolve("../myc-deploy-master");

    execSync("git add solidjs", { cwd, stdio: "inherit" });

    try {
        execSync('git commit -m "deploy solidjs"', {
            cwd,
            stdio: "inherit",
        });
    } catch {
        console.log("No changes to commit");
    }

    execSync("git push", { cwd, stdio: "inherit" });

    console.log("Deployed successfully");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
