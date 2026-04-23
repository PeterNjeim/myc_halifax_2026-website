import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

const TEMP = "../myc-build-temp";
const DEPLOY = "../myc-deploy-master";
const PRESERVE = new Set([
    ".git",
    ".nojekyll",
    ".gitignore",
    "README.md",
]);

function run(cmd: string, cwd?: string) {
    execSync(cmd, { stdio: "inherit", cwd });
}

async function cleanDir(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        if (PRESERVE.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);

        await fs.rm(fullPath, { recursive: true, force: true });
    }
}

async function main() {
    console.log("Creating clean build from HEAD...");

    // 1. Create temp worktree from current branch HEAD
    run(`git worktree add ${TEMP} HEAD`);

    try {
        // 2. Install deps + build in clean env
        run("npm install", TEMP);
        run("npm run build", TEMP);

        // 3. Copy dist → master worktree
        await cleanDir(DEPLOY);
        await fs.mkdir(DEPLOY, { recursive: true });

        const copyDir = async (src: string, dest: string) => {
            const entries = await fs.readdir(src, { withFileTypes: true });
            for (const entry of entries) {
                const s = path.join(src, entry.name);
                const d = path.join(dest, entry.name);

                if (entry.isDirectory()) {
                    await fs.mkdir(d, { recursive: true });
                    await copyDir(s, d);
                } else {
                    await fs.copyFile(s, d);
                }
            }
        };

        await copyDir(`${TEMP}/dist`, DEPLOY);

        // .nojekyll
        await fs.writeFile(path.join(DEPLOY, ".nojekyll"), "");

        // 4. Commit + push
        run("git add .", "../myc-deploy-master");

        try {
            run(`git commit -m "deploy solidjs"`, "../myc-deploy-master");
        } catch {
            console.log("No changes to commit");
        }

        run("git push", "../myc-deploy-master");
    } finally {
        // 5. Clean up
        run(`git worktree remove ${TEMP} --force`);
    }

    console.log("Deploy complete");
}

main();
