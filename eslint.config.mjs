import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Module boundaries, enforced by the linter.
 *
 * A convention that lives only in a README lasts until the first deadline. These
 * rules make a cross-module import a build failure.
 *
 * The shape being protected:
 *
 *   kernel/      importable by anybody; imports no functional module
 *   modules/x/   may import kernel, db, lib/bs — never modules/y or lib/y
 *   lib/x/       domain services, same rule while they migrate into modules/
 *   app/         may import anything; it is the composition layer
 *
 * When two modules genuinely need to talk, the answer is a port in
 * `kernel/ports.ts` reached with `resolve()` / `callPort()` — which is exactly
 * what these rules leave available.
 */

const MODULES = ["attendance", "leave", "org", "calendar", "people", "payroll", "notifications"];

/** Everything a module may not import: its siblings, in either location. */
function isolate(moduleName) {
  return MODULES.filter((s) => s !== moduleName).flatMap((s) => [
    {
      group: [`@/modules/${s}/*`, `**/modules/${s}/*`],
      message: `Do not import modules/${s} from ${moduleName}. Add a port to kernel/ports.ts and reach it with resolve()/callPort(); a direct import ties the deployment and the failure of the two modules together.`,
    },
    {
      group: [`@/lib/${s}`, `@/lib/${s}/*`],
      message: `Do not import lib/${s} from ${moduleName}. Cross-module access goes through a port; genuinely shared helpers belong in kernel/.`,
    },
  ]);
}

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // The kernel is the contract layer. If it imports a module, the direction of
  // dependency has inverted and the boundary is decorative.
  {
    files: ["src/kernel/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules/*", "**/modules/*"],
              message:
                "The kernel must not import a functional module. Modules register themselves with the kernel, never the other way round. (kernel/boot.ts is the single wiring exception.)",
            },
            {
              group: ["@/lib/leave", "@/lib/attendance", "@/lib/attendance/*"],
              message:
                "The kernel must not import a module's domain service. Move the shared piece into kernel/.",
            },
          ],
        },
      ],
    },
  },
  {
    // boot.ts exists to import every module exactly once. That is its job.
    files: ["src/kernel/boot.ts"],
    rules: { "no-restricted-imports": "off" },
  },

  ...MODULES.map((name) => ({
    files: [`src/modules/${name}/**/*.ts`, `src/modules/${name}/**/*.tsx`],
    rules: {
      "no-restricted-imports": ["error", { patterns: isolate(name) }],
    },
  })),

  // The domain services still living under lib/ are held to the same rule.
  {
    files: ["src/lib/attendance/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/leave", "@/db/schema/leave", "@/modules/leave/*"],
              message:
                'Attendance must reach leave through the leave port (callPort("leave", …)), never by importing it.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/leave.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/attendance",
                "@/lib/attendance/*",
                "@/db/schema/attendance",
                "@/modules/attendance/*",
              ],
              message:
                "Leave must not write attendance. Publish a domain event; attendance subscribes to it.",
            },
          ],
        },
      ],
    },
  },

  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
