import { describe, expect, it } from "vitest";
import {
  buildSonarTestExecutionsXml,
  convertJunitToSonarTestExecutions,
  parseArgs,
  readJunitSuite,
} from "../../../scripts/junit-to-sonar.mjs";

describe("junit-to-sonar converter", () => {
  it("parses --key=value CLI arguments into a flat key/value map", () => {
    expect(
      parseArgs([
        "--input=in.xml",
        "--output=out.xml",
        "--flag=true",
        "ignored-positional",
      ]),
    ).toEqual({
      input: "in.xml",
      output: "out.xml",
      flag: "true",
    });
  });

  it("groups test cases by their testsuite file path", () => {
    const junit = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="vitest tests" tests="2" failures="1" errors="0" time="0.12">
  <testsuite name="tests/unit/example.test.ts" timestamp="2026-01-01T00:00:00.000Z" hostname="host" tests="1" failures="0" errors="0" skipped="0" time="0.05">
    <testcase classname="tests/unit/example.test.ts" name="passes" time="0.050"/>
  </testsuite>
  <testsuite name="tests/unit/other.test.ts" timestamp="2026-01-01T00:00:00.000Z" hostname="host" tests="1" failures="1" errors="0" skipped="0" time="0.07">
    <testcase classname="tests/unit/other.test.ts" name="fails" time="0.070">
      <failure message="boom" type="AssertionError"/>
    </testcase>
  </testsuite>
</testsuites>
`;

    const files = readJunitSuite(junit);
    expect(files.size).toBe(2);
    expect(files.get("tests/unit/example.test.ts")).toEqual([
      {
        name: "passes",
        duration: 50,
        failure: null,
        error: null,
        skipped: false,
      },
    ]);
    expect(files.get("tests/unit/other.test.ts")).toEqual([
      {
        name: "fails",
        duration: 70,
        failure: { message: "boom", type: "AssertionError" },
        error: null,
        skipped: false,
      },
    ]);
  });

  it("renders the Sonar generic test-execution schema (testExecutions version=1, <file>, <testCase>)", () => {
    const files = new Map([
      [
        "tests/unit/example.test.ts",
        [
          {
            name: "passes",
            duration: 250,
            failure: null,
            error: null,
            skipped: false,
          },
          {
            name: "skipped-one",
            duration: 0,
            failure: null,
            error: null,
            skipped: true,
          },
        ],
      ],
    ]);

    const xml = buildSonarTestExecutionsXml(files);

    expect(xml).toContain('<testExecutions version="1">');
    expect(xml).toContain('<file path="tests/unit/example.test.ts">');
    expect(xml).toContain('<testCase name="passes" duration="250">');
    expect(xml).toContain("<skipped/>");
    expect(xml).toContain("</testExecutions>");
  });

  it("marks failed test cases with <failure/> and errored ones with <error/>", () => {
    const files = new Map([
      [
        "tests/unit/x.test.ts",
        [
          {
            name: "boom",
            duration: 100,
            failure: { message: "nope", type: "AssertionError" },
            error: null,
            skipped: false,
          },
          {
            name: "boom-err",
            duration: 200,
            failure: null,
            error: { message: "kaboom", type: "TypeError" },
            skipped: false,
          },
        ],
      ],
    ]);

    const xml = buildSonarTestExecutionsXml(files);

    const failureIndex = xml.indexOf('name="boom" duration="100"');
    const errorIndex = xml.indexOf('name="boom-err" duration="200"');
    expect(failureIndex).toBeGreaterThan(-1);
    expect(xml).toContain("<failure/>");
    expect(xml).toContain("<error/>");
    expect(failureIndex).toBeLessThan(errorIndex);
  });

  it("converts the Vitest-produced JUnit XML into the Sonar schema end-to-end", () => {
    const junit = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="vitest tests" tests="1" failures="0" errors="0" time="0.005">
  <testsuite name="tests/unit/ok.test.ts" timestamp="2026-01-01T00:00:00.000Z" hostname="host" tests="1" failures="0" errors="0" skipped="0" time="0.005">
    <testcase classname="tests/unit/ok.test.ts" name="works &amp; &quot;ok&quot;" time="0.005"/>
  </testsuite>
</testsuites>
`;

    const xml = convertJunitToSonarTestExecutions(junit);
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<testExecutions version="1">');
    expect(xml).toContain('<file path="tests/unit/ok.test.ts">');
    expect(xml).toContain(
      '<testCase name="works &amp; &quot;ok&quot;" duration="5">',
    );
  });

  it("escapes unsafe XML characters in file paths and test names", () => {
    const files = new Map([
      [
        "tests/unit/<weird>&.test.ts",
        [
          {
            name: 'has <bad> "chars"',
            duration: 1,
            failure: null,
            error: null,
            skipped: false,
          },
        ],
      ],
    ]);
    const xml = buildSonarTestExecutionsXml(files);
    expect(xml).toContain(
      '<file path="tests/unit/&lt;weird&gt;&amp;.test.ts">',
    );
    expect(xml).toContain(
      '<testCase name="has &lt;bad&gt; &quot;chars&quot;" duration="1">',
    );
  });
});
