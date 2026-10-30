import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { formatCliHelp } from "./cli.ts";

describe("Distribution Guide & CLI Packaging (Issue #11)", () => {
  const packageRoot = process.cwd();
  const pkgJsonPath = resolve(packageRoot, "package.json");
  const readmePath = resolve(packageRoot, "README.md");
  const howToTestPath = resolve(packageRoot, "docs/HOW_TO_TEST.md");

  let cachedReadme: string | null = null;
  const getReadme = (): string => {
    if (cachedReadme === null) {
      assert.ok(existsSync(readmePath), "README.md must exist");
      cachedReadme = readFileSync(readmePath, "utf-8");
    }
    return cachedReadme;
  };

  let cachedHowToTest: string | null = null;
  const getHowToTest = (): string => {
    if (cachedHowToTest === null) {
      assert.ok(existsSync(howToTestPath), "docs/HOW_TO_TEST.md must exist");
      cachedHowToTest = readFileSync(howToTestPath, "utf-8");
    }
    return cachedHowToTest;
  };

  describe("package.json CLI Bin & Scripts Configuration", () => {
    test("exports standalone CLI binary sandcastle-agy pointing to executable entrypoint", () => {
      assert.ok(existsSync(pkgJsonPath), "package.json must exist");
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));

      assert.ok(pkg.bin, "package.json must define bin entry");
      assert.equal(
        pkg.bin["sandcastle-agy"],
        "./main.mts",
        "bin['sandcastle-agy'] must point to ./main.mts",
      );

      // Verify entrypoint file exists and has shebang
      const entrypointPath = resolve(packageRoot, pkg.bin["sandcastle-agy"]);
      assert.ok(existsSync(entrypointPath), "Binary entrypoint file must exist");
      const entryContent = readFileSync(entrypointPath, "utf-8");
      assert.match(
        entryContent,
        /^#!\/usr\/bin\/env node/m,
        "CLI entrypoint must begin with node shebang",
      );
    });

    test("exports shorthand CLI alias sc-agy pointing to executable entrypoint alongside sandcastle-agy", () => {
      assert.ok(existsSync(pkgJsonPath), "package.json must exist");
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));

      assert.ok(pkg.bin, "package.json must define bin entry");
      assert.equal(
        pkg.bin["sc-agy"],
        "./main.mts",
        "bin['sc-agy'] must point to ./main.mts",
      );

      // Verify entrypoint file exists and has shebang
      const entrypointPath = resolve(packageRoot, pkg.bin["sc-agy"]);
      assert.ok(existsSync(entrypointPath), "Binary entrypoint file for sc-agy must exist");
      const entryContent = readFileSync(entrypointPath, "utf-8");
      assert.match(
        entryContent,
        /^#!\/usr\/bin\/env node/m,
        "CLI entrypoint must begin with node shebang",
      );
    });

    test("defines required test and build scripts", () => {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      assert.ok(pkg.scripts["test"], "must define test script");
      assert.ok(pkg.scripts["test:unit"], "must define test:unit script");
      assert.ok(pkg.scripts["test:smoke"], "must define test:smoke script");
      assert.ok(pkg.scripts["typecheck"], "must define typecheck script");
      assert.ok(pkg.scripts["build-image"], "must define build-image script");
    });
  });

  describe("README.md Standalone Distribution & Usage Guide", () => {
    test("reads README.md content", () => {
      assert.ok(getReadme().length > 2000, "README.md should be comprehensive and non-trivial");
    });

    test("documents global installation via npm link and global install", () => {
      const readme = getReadme();
      assert.match(readme, /npm\s+link/i, "Must document npm link installation");
      assert.match(readme, /sandcastle-agy/i, "Must cite sandcastle-agy binary name");
    });

    test("documents all four primary CLI subcommands", () => {
      const readme = getReadme();
      // 1. run
      assert.match(readme, /sandcastle-agy\s+run/i, "Must document 'run' subcommand");
      assert.match(readme, /--repo|-r/i, "Must document --repo option");
      assert.match(readme, /--yes|-y/i, "Must document --yes option");

      // 2. rescue
      assert.match(readme, /sandcastle-agy\s+rescue/i, "Must document 'rescue' subcommand");

      // 3. doctor
      assert.match(readme, /sandcastle-agy\s+doctor/i, "Must document 'doctor' subcommand");

      // 4. build-image
      assert.match(readme, /sandcastle-agy\s+build-image/i, "Must document 'build-image' subcommand");
    });

    test("documents interactive Pre-Run Configuration Banner & Defaults Editor", () => {
      const readme = getReadme();
      assert.match(
        readme,
        /Pre-Run\s+Configuration|Configuration\s+Banner/i,
        "Must document Pre-Run Configuration Banner",
      );
      assert.match(readme, /Confirm\s+and\s+Start/i, "Must document confirmation option");
      assert.match(readme, /Change\s+a\s+configuration/i, "Must document interactive editing option");
    });

    test("documents multi-account GitHub authentication workflow", () => {
      const readme = getReadme();
      assert.match(readme, /gh\s+auth\s+switch/i, "Must document account switching via gh CLI");
      assert.match(readme, /MTR-S/i, "Must document personal account identity");
      assert.match(readme, /GH_TOKEN|GITHUB_TOKEN/i, "Must document token environment overrides");
    });

    test("documents zero-footprint target repository isolation guarantee", () => {
      const readme = getReadme();
      assert.match(
        readme,
        /zero-footprint|target\s+repositor/i,
        "Must document target repository zero-footprint guarantee",
      );
    });

    test("preserves Matt Pocock and upstream @ai-hero/sandcastle attribution and copyright notices", () => {
      const readme = getReadme();
      assert.match(readme, /Matt Pocock/i, "Must preserve Matt Pocock attribution");
      assert.match(readme, /@ai-hero\/sandcastle/i, "Must preserve @ai-hero/sandcastle attribution");
      assert.match(readme, /MIT/i, "Must cite MIT License");
    });

    test("documents sc-agy official shorthand alias with informative callout and usage syntax", () => {
      const readme = getReadme();
      assert.match(readme, /sc-agy/i, "Must cite sc-agy binary alias");
      assert.match(
        readme,
        /sandcastle-agy\s+\|\s+sc-agy\s+<command>\s+\[options\]/,
        "Must display usage syntax with 'sandcastle-agy | sc-agy <command> [options]'",
      );
      assert.match(
        readme,
        />\s*\[!(NOTE|TIP|IMPORTANT)\][\s\S]*?sc-agy/i,
        "Must contain an informative callout highlighting sc-agy shorthand alias",
      );
    });
  });

  describe("docs/HOW_TO_TEST.md Shorthand Alias & Manual Verification Guide (Issue #18)", () => {
    test("reads docs/HOW_TO_TEST.md content", () => {
      assert.ok(getHowToTest().length > 2000, "docs/HOW_TO_TEST.md must be comprehensive");
    });

    test("documents testing and manual verification using both sandcastle-agy and sc-agy", () => {
      const howToTest = getHowToTest();
      assert.match(howToTest, /sandcastle-agy/i, "Must cite sandcastle-agy");
      assert.match(howToTest, /sc-agy/i, "Must cite sc-agy");
      assert.match(
        howToTest,
        /sc-agy\s+(doctor|run|rescue|build-image|--help|--version)/i,
        "Must document sc-agy commands for testing and manual verification",
      );
    });
  });

  describe("CLI Help Usage Syntax & Compliance (Issue #18)", () => {
    test("formatCliHelp declares syntax 'Usage: sandcastle-agy | sc-agy <command> [options]'", () => {
      const help = formatCliHelp();
      assert.match(
        help,
        /Usage:\s*\n\s*sandcastle-agy \| sc-agy <command> \[options\]/,
        "formatCliHelp must declare syntax 'Usage: sandcastle-agy | sc-agy <command> [options]'",
      );
    });
  });
});
