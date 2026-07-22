import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const nginxConfPath = resolve(repoRoot, "docker/nginx.conf");
const dockerfilePath = resolve(repoRoot, "docker/Dockerfile");
const securityHeadersPath = resolve(repoRoot, "docker/security-headers.conf");

const nginxConf = readFileSync(nginxConfPath, "utf8");
const dockerfile = readFileSync(dockerfilePath, "utf8");
const securityHeaders = readFileSync(securityHeadersPath, "utf8");

const expectedContentSecurityPolicy =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; connect-src 'self' https://app.asana.com; script-src 'self'; style-src 'self'";

function extractServerBlock(source: string): string {
  const start = source.indexOf("server {");
  if (start === -1) {
    throw new Error("No top-level `server {` block found in nginx.conf");
  }
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error("Unterminated `server {` block in nginx.conf");
}

function extractLocationBlock(source: string, locationHeader: string): string {
  const re = new RegExp(`location\\s+${locationHeader}\\s*\\{`, "g");
  const match = re.exec(source);
  if (!match) {
    throw new Error(`No location block matching ${locationHeader} found`);
  }
  const start = match.index;
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error(`Unterminated location block for ${locationHeader}`);
}

function expectSharedSecurityHeaders(block: string): void {
  expect(block).toMatch(
    /^\s*include\s+\/etc\/nginx\/security-headers\.conf\s*;/m,
  );
}

describe("docker/nginx.conf (T012 nginx runtime config)", () => {
  it("exists at docker/nginx.conf and is non-empty", () => {
    expect(nginxConf.length).toBeGreaterThan(0);
  });

  describe("server block basics (nginxinc/nginx-unprivileged 1.30-alpine)", () => {
    const serverBlock = extractServerBlock(nginxConf);

    it("listens on port 8080 (the unprivileged nginx default)", () => {
      expect(serverBlock).toMatch(/^\s*listen\s+8080\s+default_server\s*;/m);
    });

    it("also listens on the IPv6 wildcard for the same port", () => {
      expect(serverBlock).toMatch(
        /^\s*listen\s+\[::\]:8080\s+default_server\s*;/m,
      );
    });

    it("sets the document root to /usr/share/nginx/html (matches docker/Dockerfile COPY target)", () => {
      expect(serverBlock).toMatch(/^\s*root\s+\/usr\/share\/nginx\/html\s*;/m);
    });

    it("uses index.html as the directory index for SPA shell fallback", () => {
      expect(serverBlock).toMatch(/^\s*index\s+index\.html\s*;/m);
    });
  });

  describe("(1) SPA fallback routing", () => {
    it("declares a fallback location that rewrites unmatched paths to /index.html", () => {
      const rootLocation = extractLocationBlock(nginxConf, "/\\s");
      expect(rootLocation).toContain("try_files");
      expect(rootLocation).toMatch(
        /try_files\s+\$uri\s+\$uri\/\s+\/index\.html/,
      );
    });
  });

  describe("(2) service-worker file served Cache-Control: no-cache", () => {
    const swBlock = extractLocationBlock(nginxConf, "=\\s*\/sw\\.js");

    it("declares an exact-match location for /sw.js", () => {
      expect(swBlock).toBeTruthy();
    });

    it("sets Cache-Control: no-cache on /sw.js so PWA updates propagate (FR-087, research.md §10)", () => {
      expect(swBlock).toMatch(
        /^\s*add_header\s+Cache-Control\s+"no-cache"\s+always\s*;/m,
      );
    });

    it("falls through to a 404 if /sw.js is missing rather than the SPA shell", () => {
      expect(swBlock).toMatch(/try_files\s+\$uri\s+=404/);
    });

    it("includes the shared hardening headers", () => {
      expectSharedSecurityHeaders(swBlock);
    });
  });

  describe("(2a) PWA manifest served Cache-Control: no-cache", () => {
    const manifestBlock = extractLocationBlock(
      nginxConf,
      "=\\s*\/manifest\\.webmanifest",
    );

    it("declares an exact-match location for /manifest.webmanifest", () => {
      expect(manifestBlock).toBeTruthy();
    });

    it("sets Cache-Control: no-cache on /manifest.webmanifest", () => {
      expect(manifestBlock).toMatch(
        /^\s*add_header\s+Cache-Control\s+"no-cache"\s+always\s*;/m,
      );
    });

    it("maps .webmanifest to the application/manifest+json MIME type", () => {
      expect(manifestBlock).toMatch(
        /types\s*\{[^}]*application\/manifest\+json[^}]*webmanifest[^}]*\}/,
      );
    });

    it("includes the shared hardening headers", () => {
      expectSharedSecurityHeaders(manifestBlock);
    });
  });

  describe("(3) hashed assets under /assets/* served long-cache", () => {
    const assetsBlock = extractLocationBlock(nginxConf, "/assets/");

    it("declares a prefix location for /assets/", () => {
      expect(assetsBlock).toBeTruthy();
    });

    it("sets Cache-Control: public, max-age=31536000, immutable on hashed assets", () => {
      expect(assetsBlock).toMatch(
        /^\s*add_header\s+Cache-Control\s+"public,\s*max-age=31536000,\s*immutable"\s+always\s*;/m,
      );
    });

    it("returns a 404 (not the SPA shell) for an unknown /assets/* path", () => {
      expect(assetsBlock).toMatch(/try_files\s+\$uri\s+=404/);
    });

    it("includes the shared hardening headers", () => {
      expectSharedSecurityHeaders(assetsBlock);
    });
  });

  describe("(5) SPA shell served Cache-Control: no-cache", () => {
    const rootLocation = extractLocationBlock(nginxConf, "/\\s");

    it("sets Cache-Control: no-cache on non-asset responses so the shell is always revalidated", () => {
      expect(rootLocation).toMatch(
        /^\s*add_header\s+Cache-Control\s+"no-cache"\s+always\s*;/m,
      );
    });

    it("includes the shared hardening headers", () => {
      expectSharedSecurityHeaders(rootLocation);
    });
  });

  describe("shared security hardening headers", () => {
    it("declares a CSP that constrains script, style, frame, form, image, and Asana API connections", () => {
      expect(securityHeaders).toMatch(
        new RegExp(
          `add_header\\s+Content-Security-Policy\\s+"${expectedContentSecurityPolicy.replace(
            /[-/\\^$*+?.()|[\]{}]/g,
            "\\$&",
          )}"\\s+always\\s*;`,
        ),
      );
    });

    it("denies framing for clickjacking protection", () => {
      expect(securityHeaders).toMatch(
        /^\s*add_header\s+X-Frame-Options\s+"DENY"\s+always\s*;/m,
      );
    });

    it("sets a strict referrer policy", () => {
      expect(securityHeaders).toMatch(
        /^\s*add_header\s+Referrer-Policy\s+"no-referrer"\s+always\s*;/m,
      );
    });

    it("disables browser features the app does not need", () => {
      expect(securityHeaders).toMatch(
        /^\s*add_header\s+Permissions-Policy\s+"geolocation=\(\), camera=\(\), microphone=\(\)"\s+always\s*;/m,
      );
    });
  });

  describe("defensive defaults", () => {
    it("denies access to dotfile paths under the document root", () => {
      const dotBlock = extractLocationBlock(nginxConf, "~\\s*\/\\\\\\.");
      expect(dotBlock).toMatch(/^\s*deny\s+all\s*;/m);
    });
  });
});

describe("docker/Dockerfile (T012 wiring)", () => {
  it("installs docker/nginx.conf into the runtime stage so it actually takes effect", () => {
    expect(dockerfile).toMatch(
      /COPY\s+docker\/nginx\.conf\s+\/etc\/nginx\/conf\.d\/default\.conf/,
    );
  });

  it("installs the shared security-header snippet into the runtime stage", () => {
    expect(dockerfile).toMatch(
      /COPY\s+docker\/security-headers\.conf\s+\/etc\/nginx\/security-headers\.conf/,
    );
  });

  it("keeps the Vite build output in /usr/share/nginx/html (matches nginx.conf `root`)", () => {
    expect(dockerfile).toMatch(
      /COPY\s+--from=build\s+\/app\/dist\s+\/usr\/share\/nginx\/html/,
    );
  });
});
