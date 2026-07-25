import { describe, expect, it } from "vitest";
import { injectProjectTailwindSource } from "./style-fidelity.js";

describe("preview style fidelity", () => {
  it("registers the target project as a Tailwind v4 source", () => {
    const transformed = injectProjectTailwindSource(
      '@import "tailwindcss";\n@import "./tokens.css";',
      "C:/work/app/src/app/globals.css",
      "C:/work/app",
    );

    expect(transformed).toContain('@source "../..";');
    expect(transformed).toContain("component-atlas: project source");
  });

  it("leaves non-Tailwind stylesheets unchanged", () => {
    const css = '@import "./tokens.css";\n.button { display: grid; }';

    expect(
      injectProjectTailwindSource(
        css,
        "C:/work/app/src/styles.css",
        "C:/work/app",
      ),
    ).toBe(css);
  });

  it("does not inject the source twice", () => {
    const once = injectProjectTailwindSource(
      '@import "tailwindcss";',
      "C:/work/app/src/styles.css",
      "C:/work/app",
    );

    expect(
      injectProjectTailwindSource(
        once,
        "C:/work/app/src/styles.css",
        "C:/work/app",
      ),
    ).toBe(once);
  });
});
