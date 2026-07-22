#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { resolve as resolvePath } from "node:path";
import { SaxesParser } from "saxes";

const TEXT_KEYS = new Set([
  "name",
  "classname",
  "message",
  "type",
  "file",
  "duration",
]);

function attrNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function attrText(value) {
  return value == null ? "" : String(value);
}

export function parseArgs(argv = []) {
  return Object.fromEntries(
    argv.flatMap((arg) => {
      if (!arg.startsWith("--")) return [];
      const [, body] = arg.split(/^--/, 2);
      const eqIndex = body.indexOf("=");
      if (eqIndex === -1) {
        return [[body, "true"]];
      }
      return [[body.slice(0, eqIndex), body.slice(eqIndex + 1)]];
    }),
  );
}

export function readJunitSuite(input) {
  const parser = new SaxesParser({ xmlns: false });
  const files = new Map();

  let filePath = "";
  let testCase = null;
  let failureTag = null;
  let errorTag = null;
  let skippedTag = null;

  parser.on("opentag", (node) => {
    const name = node.name;
    const attrs = node.attributes ?? {};
    if (name === "testsuite") {
      filePath = attrText(attrs.name);
      if (!files.has(filePath)) {
        files.set(filePath, []);
      }
    } else if (name === "testcase") {
      testCase = {
        name: attrText(attrs.name),
        duration: Math.round(attrNumber(attrs.time) * 1000),
        failure: null,
        error: null,
        skipped: false,
      };
    } else if (testCase != null && name === "failure") {
      failureTag = {
        message: attrText(attrs.message),
        type: attrText(attrs.type),
      };
    } else if (testCase != null && name === "error") {
      errorTag = {
        message: attrText(attrs.message),
        type: attrText(attrs.type),
      };
    } else if (
      testCase != null &&
      (name === "skipped" || name === "skipped/")
    ) {
      skippedTag = true;
    }
  });

  parser.on("closetag", (node) => {
    const name = node.name;
    if (name === "testcase" && testCase != null) {
      const list = files.get(filePath) ?? [];
      list.push(testCase);
      files.set(filePath, list);
      testCase = null;
    } else if (name === "failure") {
      if (testCase != null) {
        testCase.failure = failureTag ?? { message: "", type: "" };
      }
      failureTag = null;
    } else if (name === "error") {
      if (testCase != null) {
        testCase.error = errorTag ?? { message: "", type: "" };
      }
      errorTag = null;
    } else if (name === "skipped" || name === "skipped/") {
      if (testCase != null) {
        testCase.skipped = skippedTag === true;
      }
      skippedTag = null;
    }
  });

  parser.on("error", (err) => {
    throw new Error(
      `Failed to parse JUnit XML at line ${err.line}, column ${err.column}: ${err.message}`,
    );
  });

  parser.write(input).close();

  return files;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildSonarTestExecutionsXml(files) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testExecutions version="1">',
  ];
  for (const [filePath, cases] of files) {
    lines.push(`  <file path="${escapeXml(filePath)}">`);
    for (const testCase of cases) {
      lines.push(
        `    <testCase name="${escapeXml(testCase.name)}" duration="${testCase.duration}">`,
      );
      if (testCase.failure) {
        lines.push("      <failure/>");
      } else if (testCase.error) {
        lines.push("      <error/>");
      } else if (testCase.skipped) {
        lines.push("      <skipped/>");
      }
      lines.push("    </testCase>");
    }
    lines.push("  </file>");
  }
  lines.push("</testExecutions>");
  return `${lines.join("\n")}\n`;
}

export function convertJunitToSonarTestExecutions(junitXml) {
  const files = readJunitSuite(junitXml);
  return buildSonarTestExecutionsXml(files);
}

const isMain = import.meta.url === new URL(process.argv[1], "file://").href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args["input"];
  const outputPath = args["output"] ?? "-";
  if (!inputPath) {
    process.stderr.write(
      "Usage: node scripts/junit-to-sonar.mjs --input <junit.xml> [--output <sonar.xml>]\n",
    );
    process.exit(2);
  }
  const xml = readFileSync(resolvePath(inputPath), "utf8");
  const sonarXml = convertJunitToSonarTestExecutions(xml);
  if (outputPath === "-") {
    process.stdout.write(sonarXml);
  } else {
    writeFileSync(resolvePath(outputPath), sonarXml);
  }
}
